import "@tanstack/react-start/server-only";
import { createHmac, hkdfSync, randomInt } from "node:crypto";
import { MongoServerError, ObjectId, type ClientSession, type Db } from "mongodb";
import { API_ERROR } from "@/types/api";
import { EXAM_STATUS } from "@/types/exam";
import {
  INVITE_CODE_PATTERN,
  nameKey,
  normalizeEmail,
  normalizeInviteCode,
  type VerifyInviteResponse,
} from "@/types/invite";
import { signCandidateToken } from "../auth/candidate-auth";
import { getLaunchConfig } from "../auth/launch-config";
import { AUDIT_EVENT, getCollections, USER_ROLE, type UserDoc } from "../db/collections";
import { withTransaction } from "../db/transactions";
import { getServerConfig } from "../env";
import { DomainError } from "../errors";
import { logEvent } from "../log";
import { consumeRateLimit } from "../rate-limiter";
import { createAuditLogRepository, type AuditContext } from "../repositories/audit-log-repository";
import { createExamRepository } from "../repositories/exam-repository";

/**
 * External Candidate Exam Invite Portal — an ADDITIVE integration layer.
 *
 * A coordinator creates an invite (scripts/invite-admin.ts) for one email and
 * one exam. The candidate enters their full name, email and the invite code;
 * when all three match an active, unexpired invite for an exam inside its
 * window, this service issues the SAME exam-scoped KProctor session the LMS
 * launch issues (signCandidateToken + exam scope) and the candidate continues
 * through the existing exam flow, unchanged.
 *
 * Security:
 * - Codes are never stored: only HMAC-SHA256(code) with a key derived from
 *   KPROCTOR_AUTH_SECRET (an offline DB leak can't be brute-forced into codes).
 * - Any mismatch gets one generic answer (no hint whether the code, email or
 *   name was wrong). Specific messages only once all three match.
 * - Rate-limited per IP and per email; every success/failure is audited
 *   (CANDIDATE_LAUNCHED / LAUNCH_REJECTED with method "INVITE").
 * - Invites create a dedicated candidate account. An existing account with the
 *   same email (e.g. an LMS student) is never taken over through an invite.
 */

export const INVITES_COLLECTION = "examInvites";

export interface ExamInviteDoc {
  _id: ObjectId;
  examId: ObjectId;
  /** HMAC of the normalized code; the code itself is never stored. */
  codeHash: string;
  /** Normalized (lowercase) invited email. */
  email: string;
  fullName: string;
  nameKey: string;
  status: "ACTIVE" | "REVOKED";
  expiresAt: Date;
  /** How many times the invite may open a session (candidates may need to re-enter). */
  maxRedemptions: number;
  redemptions: number;
  /** The candidate account created for (or linked to) this invite. */
  candidateId: ObjectId | null;
  lastRedeemedAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const GENERIC =
  "We couldn't verify this invitation. Check your full name, email address and invite code, or contact your exam coordinator.";
const RATE = { ip: { limit: 30, windowSeconds: 600 }, email: { limit: 10, windowSeconds: 600 } };
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".replace("L", ""); // no 0/O/1/I/L

let hmacKey: Buffer | null = null;
function codeKey(): Buffer {
  hmacKey ??= Buffer.from(
    hkdfSync("sha256", getServerConfig().authSecret, "kproctor", "kproctor-invite-code-v1", 32),
  );
  return hmacKey;
}
export const hashInviteCode = (code: string) =>
  createHmac("sha256", codeKey()).update(code).digest("hex");

export function generateInviteCode(): string {
  const pick = () => ALPHABET[randomInt(ALPHABET.length)];
  const part = () => Array.from({ length: 4 }, pick).join("");
  return `KP-${part()}-${part()}`;
}

const invites = (db: Db) => db.collection<ExamInviteDoc>(INVITES_COLLECTION);

/** Idempotent; run by the invite admin script (and tests) before invites are used. */
export async function ensureInviteIndexes(db: Db) {
  await Promise.all([
    invites(db).createIndex({ codeHash: 1 }, { name: "codeHash_unique", unique: true }),
    invites(db).createIndex({ examId: 1, email: 1 }, { name: "exam_email" }),
    invites(db).createIndex({ email: 1, candidateId: 1 }, { name: "email_candidate" }),
  ]);
}

class InviteRejected extends Error {
  constructor(
    public readonly reason: string,
    public readonly publicError: DomainError,
  ) {
    super(reason);
  }
}
const generic = (reason: string) =>
  new InviteRejected(reason, new DomainError(API_ERROR.FORBIDDEN, 403, GENERIC));

export function createInviteService(db: Db, clock: () => Date = () => new Date()) {
  const c = getCollections(db);
  const audit = createAuditLogRepository(db);
  const exams = createExamRepository(db);

  /**
   * The candidate account for this invite: the one already linked, one linked
   * to another invite for the same email, or a new account. Runs in a
   * transaction so concurrent first redemptions create exactly one account.
   */
  async function resolveCandidate(invite: ExamInviteDoc, now: Date): Promise<UserDoc> {
    return withTransaction(async (session: ClientSession) => {
      const fresh = await invites(db).findOne({ _id: invite._id }, { session });
      const linkedId =
        fresh?.candidateId ??
        (
          await invites(db).findOne(
            { email: invite.email, candidateId: { $ne: null } },
            { session, projection: { candidateId: 1 } },
          )
        )?.candidateId ??
        null;

      if (linkedId) {
        const user = await c.users.findOne({ _id: linkedId }, { session });
        if (!user || user.role !== USER_ROLE.CANDIDATE || user.status !== "ACTIVE") {
          throw generic("CANDIDATE_NOT_ALLOWED");
        }
        if (!fresh?.candidateId) {
          await invites(db).updateOne(
            { _id: invite._id, candidateId: null },
            { $set: { candidateId: user._id, updatedAt: now } },
            { session },
          );
        }
        return user;
      }

      // Never take over an existing (e.g. LMS) account that happens to use this email.
      if (await c.users.findOne({ email: invite.email }, { session, projection: { _id: 1 } })) {
        throw generic("EMAIL_BELONGS_TO_EXISTING_ACCOUNT");
      }
      const user: UserDoc = {
        _id: new ObjectId(),
        role: USER_ROLE.CANDIDATE,
        name: invite.fullName,
        email: invite.email,
        rollNumber: null,
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
      };
      await c.users.insertOne(user, { session });
      await invites(db).updateOne(
        { _id: invite._id, candidateId: null },
        { $set: { candidateId: user._id, updatedAt: now } },
        { session },
      );
      return user;
    });
  }

  return {
    /** Creates an invite and returns the plaintext code ONCE (it is only stored hashed). */
    async createInvite(input: {
      examRef: string;
      email: string;
      fullName: string;
      expiresInHours?: number;
      maxRedemptions?: number;
      createdBy: string;
    }) {
      const exam = await exams.findByRef(input.examRef);
      if (!exam) throw new Error("Exam not found.");
      const email = normalizeEmail(input.email);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid email address.");
      const fullName = input.fullName.trim().replace(/\s+/g, " ");
      if (fullName.length < 2) throw new Error("Full name is required.");
      const now = clock();
      const hours = input.expiresInHours ?? 72;
      // An invite never outlives the exam window.
      const expiresAt = new Date(Math.min(now.getTime() + hours * 3600_000, exam.endAt.getTime()));

      for (let i = 0; i < 5; i++) {
        const code = generateInviteCode();
        const doc: ExamInviteDoc = {
          _id: new ObjectId(),
          examId: exam._id,
          codeHash: hashInviteCode(code),
          email,
          fullName,
          nameKey: nameKey(fullName),
          status: "ACTIVE",
          expiresAt,
          maxRedemptions: Math.max(1, input.maxRedemptions ?? 10),
          redemptions: 0,
          candidateId: null,
          lastRedeemedAt: null,
          createdBy: input.createdBy,
          createdAt: now,
          updatedAt: now,
        };
        try {
          await invites(db).insertOne(doc);
          return { code, invite: doc, exam };
        } catch (error) {
          if (!(error instanceof MongoServerError && error.code === 11000)) throw error;
          // Astronomically unlikely code collision: draw again.
        }
      }
      throw new Error("Could not generate a unique invite code.");
    },

    async revokeInvite(inviteId: ObjectId) {
      const res = await invites(db).updateOne(
        { _id: inviteId },
        { $set: { status: "REVOKED", updatedAt: clock() } },
      );
      return res.matchedCount === 1;
    },

    /**
     * POST /api/invites/verify. Returns where to go next plus the session token
     * (the handler turns it into the HttpOnly cookie). Throws DomainError.
     */
    async redeem(
      body: unknown,
      ctx: AuditContext,
    ): Promise<VerifyInviteResponse & { sessionToken: string; sessionTtlSeconds: number }> {
      const b = (body ?? {}) as Record<string, unknown>;
      const rawName = typeof b.fullName === "string" ? b.fullName : "";
      const rawEmail = typeof b.email === "string" ? b.email : "";
      const rawCode = typeof b.code === "string" ? b.code : "";
      if (!rawName.trim() || rawName.length > 200) {
        throw new DomainError(API_ERROR.VALIDATION_ERROR, 422, "Enter your full name.");
      }
      const email = normalizeEmail(rawEmail);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
        throw new DomainError(API_ERROR.VALIDATION_ERROR, 422, "Enter a valid email address.");
      }
      const code = normalizeInviteCode(rawCode.slice(0, 40));
      if (!code || !INVITE_CODE_PATTERN.test(code)) {
        throw new DomainError(
          API_ERROR.VALIDATION_ERROR,
          422,
          "Enter the invite code in the format KP-XXXX-XXXX.",
        );
      }

      await consumeRateLimit(db, `invite:ip:${ctx.ipAddress ?? "unknown"}`, RATE.ip);
      await consumeRateLimit(db, `invite:email:${email}`, RATE.email);

      const now = clock();
      let examId: ObjectId | null = null;
      try {
        const invite = await invites(db).findOne({ codeHash: hashInviteCode(code) });
        // One generic answer for every mismatch: no hint which field was wrong.
        if (!invite || invite.email !== email || invite.nameKey !== nameKey(rawName)) {
          throw generic(invite ? "DETAILS_MISMATCH" : "UNKNOWN_CODE");
        }
        examId = invite.examId;
        // From here the person knows code + email + name, so specific messages are safe.
        if (invite.status !== "ACTIVE") {
          throw new InviteRejected(
            "REVOKED",
            new DomainError(
              API_ERROR.FORBIDDEN,
              403,
              "This invitation is no longer valid. Contact your exam coordinator.",
            ),
          );
        }
        if (invite.expiresAt <= now) {
          throw new InviteRejected(
            "EXPIRED",
            new DomainError(
              API_ERROR.FORBIDDEN,
              403,
              "This invitation has expired. Contact your exam coordinator.",
            ),
          );
        }
        if (invite.redemptions >= invite.maxRedemptions) {
          throw new InviteRejected(
            "REDEMPTION_LIMIT",
            new DomainError(
              API_ERROR.FORBIDDEN,
              403,
              "This invitation has been used too many times. Contact your exam coordinator.",
            ),
          );
        }
        const exam = await c.exams.findOne({ _id: invite.examId });
        if (!exam || exam.status !== EXAM_STATUS.PUBLISHED || now >= exam.endAt) {
          throw new InviteRejected(
            "EXAM_CLOSED",
            new DomainError(
              API_ERROR.EXAM_NOT_ACTIVE,
              403,
              "This examination is not available any more.",
            ),
          );
        }
        if (now < exam.startAt) {
          throw new InviteRejected(
            "EXAM_NOT_OPEN",
            new DomainError(
              API_ERROR.EXAM_NOT_ACTIVE,
              403,
              `This examination opens at ${exam.startAt.toISOString().replace(".000Z", "Z")} (UTC). Please come back then.`,
            ),
          );
        }

        const candidate = await resolveCandidate(invite, now);
        const counted = await invites(db).updateOne(
          { _id: invite._id, status: "ACTIVE", redemptions: { $lt: invite.maxRedemptions } },
          { $inc: { redemptions: 1 }, $set: { lastRedeemedAt: now, updatedAt: now } },
        );
        if (counted.modifiedCount !== 1) throw generic("REDEMPTION_RACE");

        const ttl = getLaunchConfig().sessionTtlSeconds;
        const sessionToken = signCandidateToken(candidate._id.toHexString(), {
          ttlSeconds: ttl,
          examId: exam._id.toHexString(),
        });
        await audit.record({
          eventType: AUDIT_EVENT.CANDIDATE_LAUNCHED,
          actorType: "CANDIDATE",
          actorId: candidate._id,
          attemptId: null,
          examId: exam._id,
          candidateId: candidate._id,
          context: ctx,
          metadata: { method: "INVITE", inviteId: invite._id.toHexString() },
          at: now,
        });
        return {
          redirectTo: `/exam/${exam._id.toHexString()}`,
          sessionToken,
          sessionTtlSeconds: ttl,
        };
      } catch (error) {
        if (!(error instanceof InviteRejected)) throw error;
        logEvent("invite rejected", { reason: error.reason });
        await audit
          .record({
            eventType: AUDIT_EVENT.LAUNCH_REJECTED,
            actorType: "SYSTEM",
            actorId: null,
            attemptId: null,
            examId,
            candidateId: null,
            context: ctx,
            metadata: { method: "INVITE", reason: error.reason },
            at: now,
          })
          .catch(() => undefined);
        throw error.publicError;
      }
    },
  };
}
export type InviteService = ReturnType<typeof createInviteService>;

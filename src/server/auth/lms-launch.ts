import "@tanstack/react-start/server-only";
import { createHash, verify as verifySignature } from "node:crypto";
import { MongoServerError, ObjectId, type Db } from "mongodb";
import { EXAM_STATUS } from "@/types/exam";
import { AUDIT_EVENT, getCollections, USER_ROLE, type UserDoc } from "../db/collections";
import { logEvent } from "../log";
import { consumeRateLimit } from "../rate-limiter";
import { createAuditLogRepository, type AuditContext } from "../repositories/audit-log-repository";
import { createExamRepository } from "../repositories/exam-repository";
import { sessionCookie, signCandidateToken } from "./candidate-auth";
import { getLaunchConfig, type LaunchConfig } from "./launch-config";

/**
 * Trusted LMS → KProctor launch.
 *
 * The LMS backend (after authenticating the user itself) signs a short-lived,
 * single-use launch token with its Ed25519 private key and sends the browser
 * to `/api/auth/lms-launch` (GET ?token= or an auto-submitted POST form).
 * KProctor verifies it, burns its `jti`, maps the LMS user to a candidate,
 * checks the exam, and exchanges it for an HttpOnly KProctor session cookie
 * scoped to that exam. The launch token is worthless after that one use.
 *
 * Token: compact JWS, header {"alg":"EdDSA","typ":"JWT"}, payload:
 *   iss  LMS issuer (KPROCTOR_LMS_ISSUER)      aud  "kproctor-launch"
 *   sub  LMS user id                           jti  unique token id (16–128 chars)
 *   iat / exp  seconds; exp - iat <= KPROCTOR_LAUNCH_MAX_LIFETIME_SECONDS
 *   exam  KProctor exam code or id
 *   name, email?, rollNumber?  profile, used to create the candidate on first launch
 */

export const LAUNCH_TOKENS_COLLECTION = "launchTokens";
export const LAUNCH_AUDIENCE = "kproctor-launch";

export type LaunchRejection =
  | "DISABLED"
  | "MALFORMED"
  | "BAD_ALGORITHM"
  | "BAD_SIGNATURE"
  | "BAD_ISSUER"
  | "BAD_AUDIENCE"
  | "EXPIRED"
  | "NOT_YET_VALID"
  | "LIFETIME_TOO_LONG"
  | "BAD_CLAIMS"
  | "REPLAYED"
  | "CANDIDATE_NOT_ALLOWED"
  | "IDENTITY_CONFLICT"
  | "EXAM_NOT_AVAILABLE"
  | "RATE_LIMITED";

export interface LaunchClaims {
  iss: string;
  aud: string | string[];
  sub: string;
  jti: string;
  iat: number;
  exp: number;
  exam: string;
  name?: string;
  email?: string;
  rollNumber?: string;
}

export type LaunchResult =
  | { ok: true; candidateId: ObjectId; examId: ObjectId; cookie: string; location: string }
  | { ok: false; reason: LaunchRejection };

class Rejected extends Error {
  constructor(public readonly reason: LaunchRejection) {
    super(reason);
  }
}
const reject = (reason: LaunchRejection): never => {
  throw new Rejected(reason);
};

const str = (v: unknown, min: number, max: number) =>
  typeof v === "string" && v.length >= min && v.length <= max;

/** Signature, algorithm and claim checks. Pure: no database access. */
export function verifyLaunchToken(
  token: string,
  config: Pick<
    LaunchConfig,
    "lmsPublicKey" | "lmsIssuer" | "audience" | "maxLifetimeSeconds" | "clockSkewSeconds"
  >,
  nowMs: number = Date.now(),
): LaunchClaims {
  if (!config.lmsPublicKey || !config.lmsIssuer) reject("DISABLED");
  if (token.length > 4096) reject("MALFORMED");
  const parts = token.split(".");
  if (parts.length !== 3) reject("MALFORMED");
  const [h, p, s] = parts;

  let header: { alg?: unknown; typ?: unknown };
  let claims: Partial<LaunchClaims>;
  try {
    header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  } catch {
    return reject("MALFORMED");
  }
  // Pinned algorithm: no "none", no HMAC-with-public-key confusion.
  if (header.alg !== "EdDSA") reject("BAD_ALGORITHM");
  const signature = Buffer.from(s, "base64url");
  if (
    signature.length !== 64 ||
    !verifySignature(null, Buffer.from(`${h}.${p}`), config.lmsPublicKey!, signature)
  ) {
    reject("BAD_SIGNATURE");
  }

  const now = Math.floor(nowMs / 1000);
  const skew = config.clockSkewSeconds;
  if (claims.iss !== config.lmsIssuer) reject("BAD_ISSUER");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(config.audience)) reject("BAD_AUDIENCE");
  if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)) reject("BAD_CLAIMS");
  const iat = claims.iat!;
  const exp = claims.exp!;
  if (iat > now + skew) reject("NOT_YET_VALID");
  if (exp <= now) reject("EXPIRED");
  if (exp - iat > config.maxLifetimeSeconds || now - iat > config.maxLifetimeSeconds + skew) {
    reject("LIFETIME_TOO_LONG");
  }
  if (!str(claims.jti, 16, 128) || !/^[\w-]+$/.test(claims.jti!)) reject("BAD_CLAIMS");
  if (!str(claims.sub, 1, 128) || !str(claims.exam, 1, 64)) reject("BAD_CLAIMS");
  if (claims.name !== undefined && !str(claims.name, 1, 200)) reject("BAD_CLAIMS");
  if (claims.email !== undefined && !str(claims.email, 3, 320)) reject("BAD_CLAIMS");
  if (claims.rollNumber !== undefined && !str(claims.rollNumber, 1, 64)) reject("BAD_CLAIMS");
  return claims as LaunchClaims;
}

/** Burns the token id. The unique _id makes this atomic: a replay hits the duplicate key. */
async function consumeTokenId(db: Db, claims: LaunchClaims, skewSeconds: number) {
  const id = createHash("sha256").update(`${claims.iss}\n${claims.jti}`).digest("hex");
  try {
    await db
      .collection<{ _id: string; usedAt: Date; expiresAt: Date }>(LAUNCH_TOKENS_COLLECTION)
      .insertOne({
        _id: id,
        usedAt: new Date(),
        // Kept until the token could no longer be valid anyway, then removed by TTL.
        expiresAt: new Date((claims.exp + skewSeconds + 60) * 1000),
      });
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) reject("REPLAYED");
    throw error;
  }
}

/** Maps the LMS user to an active candidate, creating it on first launch. Never auto-links. */
async function resolveCandidate(db: Db, claims: LaunchClaims): Promise<UserDoc> {
  const users = getCollections(db).users;
  const existing = await users.findOne({ lmsUserId: claims.sub });
  const now = new Date();
  if (existing) {
    if (existing.role !== USER_ROLE.CANDIDATE || existing.status !== "ACTIVE") {
      reject("CANDIDATE_NOT_ALLOWED");
    }
    if (claims.name && claims.name !== existing.name) {
      await users.updateOne({ _id: existing._id }, { $set: { name: claims.name, updatedAt: now } });
    }
    return existing;
  }
  if (!claims.name) reject("BAD_CLAIMS");
  const doc: UserDoc = {
    _id: new ObjectId(),
    role: USER_ROLE.CANDIDATE,
    lmsUserId: claims.sub,
    name: claims.name!,
    email: claims.email ?? null,
    rollNumber: claims.rollNumber ?? null,
    avatarUrl: null,
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  };
  try {
    await users.insertOne(doc);
    return doc;
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      // Either a concurrent first launch (same LMS user) or an existing KProctor
      // account with this email/roll number. Linking accounts by email would let a
      // mis-assigned LMS address take over someone else's exams, so it is refused.
      const raced = await users.findOne({ lmsUserId: claims.sub });
      if (raced) return raced;
      reject("IDENTITY_CONFLICT");
    }
    throw error;
  }
}

export async function processLmsLaunch(
  db: Db,
  token: string | null,
  opts: { ctx: AuditContext; secure: boolean; config?: LaunchConfig; now?: number },
): Promise<LaunchResult> {
  const config = opts.config ?? getLaunchConfig();
  const audit = createAuditLogRepository(db);
  let examId: ObjectId | null = null;
  try {
    await consumeRateLimit(db, `launch:${opts.ctx.ipAddress ?? "unknown"}`, {
      limit: 60,
      windowSeconds: 600,
    }).catch(() => reject("RATE_LIMITED"));
    if (!token) reject("MALFORMED");
    const claims = verifyLaunchToken(token!, config, opts.now);
    await consumeTokenId(db, claims, config.clockSkewSeconds);

    const exam = await createExamRepository(db).findByRef(claims.exam);
    if (!exam || exam.status !== EXAM_STATUS.PUBLISHED || exam.endAt <= new Date()) {
      reject("EXAM_NOT_AVAILABLE");
    }
    examId = exam!._id;
    const candidate = await resolveCandidate(db, claims);

    const session = signCandidateToken(candidate._id.toHexString(), {
      ttlSeconds: config.sessionTtlSeconds,
      examId: exam!._id.toHexString(),
    });
    await audit.record({
      eventType: AUDIT_EVENT.CANDIDATE_LAUNCHED,
      actorType: "CANDIDATE",
      actorId: candidate._id,
      attemptId: null,
      examId: exam!._id,
      candidateId: candidate._id,
      context: opts.ctx,
      metadata: { method: "LMS", issuer: claims.iss },
      at: new Date(),
    });
    return {
      ok: true,
      candidateId: candidate._id,
      examId: exam!._id,
      cookie: sessionCookie(session, config.sessionTtlSeconds, opts.secure || config.production),
      location: `/exam/${exam!._id.toHexString()}`,
    };
  } catch (error) {
    if (!(error instanceof Rejected)) throw error;
    // Reason code only: never the token or its claims.
    logEvent("launch rejected", { reason: error.reason });
    if (error.reason !== "RATE_LIMITED") {
      await audit
        .record({
          eventType: AUDIT_EVENT.LAUNCH_REJECTED,
          actorType: "SYSTEM",
          actorId: null,
          attemptId: null,
          examId,
          candidateId: null,
          context: opts.ctx,
          metadata: { reason: error.reason },
          at: new Date(),
        })
        .catch(() => undefined);
    }
    return { ok: false, reason: error.reason };
  }
}

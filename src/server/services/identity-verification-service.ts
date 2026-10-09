import "@tanstack/react-start/server-only";
import { MongoServerError, ObjectId, type ClientSession, type Db } from "mongodb";
import { API_ERROR } from "@/types/api";
import {
  ATTEMPT_STATUS,
  IDENTITY_STATUS as ATTEMPT_IDENTITY_STATUS,
  PRE_EXAM_STATUSES,
} from "@/types/exam-attempt";
import {
  DOCUMENT_FILE_TYPES,
  ID_DOCUMENT_TYPES,
  IDENTITY_VERIFICATION_STATUS as S,
  SCAN_STATUS,
  type AssetAccessResponse,
  type IdDocumentType,
  type IdentityReviewResponse,
  type IdentityStatusResponse,
  type IdentityVerificationStatus,
  type ReviewDecision,
} from "@/types/identity";
import type { ProctoringPolicy } from "@/types/exam";
import {
  AUDIT_EVENT,
  getCollections,
  USER_ROLE,
  type AuditEvent,
  type ExamAttemptDoc,
  type IdentityVerificationDoc,
  type UserDoc,
} from "../db/collections";
import { withTransaction } from "../db/transactions";
import { DomainError, attemptExpired, attemptNotFound, unauthenticated } from "../errors";
import { getIdentityConfig, type IdentityConfig } from "../identity/config";
import { sha256Hex } from "../identity/crypto";
import { CONTENT_TYPE, validateDocument, validatePhoto } from "../identity/file-validation";
import { getMalwareScanner, type MalwareScanner } from "../identity/malware-scanner";
import { assertTransition, type IdentityActor } from "../identity/state-machine";
import { getIdentityStorage, type IdentityDocumentStorage } from "../identity/storage";
import { newObjectKey } from "../identity/storage/types";
import {
  getVerificationProvider,
  type IdentityVerificationProvider,
  type VerificationOutcome,
} from "../identity/verification-provider";
import { logError, logEvent } from "../log";
import { consumeRateLimit } from "../rate-limiter";
import { createAuditLogRepository, type AuditContext } from "../repositories/audit-log-repository";
import { createExamSessionRepository } from "../repositories/exam-session-repository";
import { createIdentityVerificationRepository } from "../repositories/identity-verification-repository";
import { createUserRepository } from "../repositories/user-repository";

/** Candidate-safe messages for the last error recorded on a verification. */
const ERROR_MESSAGES: Record<string, string> = {
  UNSUPPORTED_DOCUMENT: "This file type isn't supported. Upload a JPG, PNG or PDF of your ID.",
  DOCUMENT_REJECTED:
    "This file couldn't be accepted. Upload a different, clear image or PDF of your ID.",
};

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const minDate = (...dates: (Date | null | undefined)[]) => {
  const valid = dates.filter((d): d is Date => d instanceof Date);
  return valid.length ? new Date(Math.min(...valid.map((d) => d.getTime()))) : null;
};

const conflict = () =>
  new DomainError(
    API_ERROR.INVALID_STATE,
    409,
    "Your verification was updated in another window. Refresh the page to continue.",
  );

export interface IdentityServiceDeps {
  clock?: () => Date;
  storage?: IdentityDocumentStorage;
  scanner?: MalwareScanner;
  provider?: IdentityVerificationProvider;
  config?: IdentityConfig;
}

/**
 * Server-authoritative identity verification. The browser can only submit a
 * photo, a document and consent; every status, result and timestamp is
 * decided here, and every state change commits atomically with its audit event.
 */
export function createIdentityVerificationService(db: Db, deps: IdentityServiceDeps = {}) {
  const clock = deps.clock ?? (() => new Date());
  const config = () => deps.config ?? getIdentityConfig();
  const storage = () => deps.storage ?? getIdentityStorage();
  const scanner = () => deps.scanner ?? getMalwareScanner();
  const provider = () => deps.provider ?? getVerificationProvider();

  const c = getCollections(db);
  const users = createUserRepository(db);
  const sessions = createExamSessionRepository(db);
  const verifications = createIdentityVerificationRepository(db);
  const audit = createAuditLogRepository(db);

  // ─── Shared guards ──────────────────────────────────────────────────────────

  interface CandidateContext {
    candidate: UserDoc;
    attempt: ExamAttemptDoc;
    policy: ProctoringPolicy;
    verification: IdentityVerificationDoc | null;
  }

  async function auditEvent(
    session: ClientSession | undefined,
    eventType: AuditEvent,
    v: { attemptId: ObjectId; examId: ObjectId; candidateId: ObjectId },
    actor: { type: IdentityActor; id: ObjectId | null },
    ctx: AuditContext,
    at: Date,
    metadata?: Record<string, unknown>,
  ) {
    await audit.record(
      {
        eventType,
        attemptId: v.attemptId,
        examId: v.examId,
        candidateId: v.candidateId,
        actorType: actor.type,
        actorId: actor.id,
        context: ctx,
        metadata,
        at,
      },
      session,
    );
  }

  /** Closes an expired attempt and its verification, atomically with audit events. */
  async function expire(attempt: ExamAttemptDoc, ctx: AuditContext, now: Date) {
    await withTransaction(async (session) => {
      const res = await c.examAttempts.updateOne(
        { _id: attempt._id, status: { $in: [...PRE_EXAM_STATUSES] }, expiresAt: { $lte: now } },
        { $set: { status: ATTEMPT_STATUS.EXPIRED, updatedAt: now } },
        { session },
      );
      if (res.modifiedCount) {
        await auditEvent(
          session,
          AUDIT_EVENT.ATTEMPT_EXPIRED,
          { attemptId: attempt._id, examId: attempt.examId, candidateId: attempt.candidateId },
          { type: "SYSTEM", id: null },
          ctx,
          now,
        );
      }
      const v = await verifications.findByAttempt(attempt._id, session);
      if (v && v.status !== S.VERIFIED && v.status !== S.EXPIRED) {
        await c.identityVerifications.updateOne(
          { _id: v._id },
          { $set: { status: S.EXPIRED, updatedAt: now }, $inc: { version: 1 } },
          { session },
        );
        await auditEvent(
          session,
          AUDIT_EVENT.IDENTITY_VERIFICATION_EXPIRED,
          v,
          { type: "SYSTEM", id: null },
          ctx,
          now,
          { fromStatus: v.status },
        );
      }
    });
  }

  async function loadCandidateContext(
    attemptIdRaw: string,
    candidateId: ObjectId,
    ctx: AuditContext,
    { mutate }: { mutate: boolean },
  ): Promise<CandidateContext> {
    const now = clock();
    const candidate = await users.findActiveCandidate(candidateId);
    if (!candidate) throw unauthenticated();
    if (!/^[a-f\d]{24}$/i.test(attemptIdRaw)) throw attemptNotFound();
    // Ownership is part of the query: another candidate's attempt is "not found".
    const attempt = await c.examAttempts.findOne({ _id: new ObjectId(attemptIdRaw), candidateId });
    if (!attempt) throw attemptNotFound();

    const isPreExam = PRE_EXAM_STATUSES.includes(attempt.status);
    if (attempt.status === ATTEMPT_STATUS.EXPIRED || (isPreExam && attempt.expiresAt <= now)) {
      await expire(attempt, ctx, now);
      throw attemptExpired();
    }
    if (
      attempt.status === ATTEMPT_STATUS.CANCELLED ||
      attempt.status === ATTEMPT_STATUS.SUBMITTED ||
      attempt.status === ATTEMPT_STATUS.AUTO_SUBMITTED
    ) {
      throw new DomainError(API_ERROR.INVALID_STATE, 409, "This exam attempt has ended.");
    }

    const snapshot = await sessions.findByAttempt(attempt._id);
    const policy = snapshot?.proctoringPolicy;
    if (!policy?.identityVerificationRequired) {
      throw new DomainError(
        API_ERROR.INVALID_STATE,
        409,
        "Identity verification isn't required for this exam.",
      );
    }
    if (mutate && attempt.status !== ATTEMPT_STATUS.IDENTITY_VERIFICATION) {
      throw new DomainError(
        API_ERROR.INVALID_STATE,
        409,
        attempt.status === ATTEMPT_STATUS.INSTRUCTIONS ||
          attempt.status === ATTEMPT_STATUS.SYSTEM_CHECK
          ? "Complete the previous steps before verifying your identity."
          : "Identity verification is already complete for this attempt.",
      );
    }
    if (
      !mutate &&
      ![
        ATTEMPT_STATUS.IDENTITY_VERIFICATION,
        ATTEMPT_STATUS.READY,
        ATTEMPT_STATUS.IN_PROGRESS,
      ].includes(attempt.status as never)
    ) {
      throw new DomainError(
        API_ERROR.INVALID_STATE,
        409,
        "Complete the previous steps before verifying your identity.",
      );
    }

    const verification = await verifications.findByAttempt(attempt._id);
    return { candidate, attempt, policy, verification };
  }

  function rateLimitKey(action: string, candidateId: ObjectId, attemptId: ObjectId) {
    return `idv:${action}:${candidateId.toHexString()}:${attemptId.toHexString()}`;
  }

  function canProceed(v: IdentityVerificationDoc | null, policy: ProctoringPolicy) {
    if (!v) return false;
    if (v.status === S.VERIFIED) return true;
    return v.status === S.REVIEW_REQUIRED && policy.identityReviewPolicy === "ALLOW_PENDING_REVIEW";
  }

  function toStatusResponse(
    v: IdentityVerificationDoc | null,
    policy: ProctoringPolicy,
    now: Date,
  ): IdentityStatusResponse {
    const cfg = config();
    return {
      status: v?.status ?? S.NOT_STARTED,
      photo: { captured: Boolean(v?.photo), capturedAt: iso(v?.photo?.capturedAt) },
      document: {
        present: Boolean(v?.idDocument),
        documentType: v?.idDocument?.documentType ?? null,
        fileType: v?.idDocument?.fileType ?? null,
        scanStatus: v?.idDocument?.scanStatus ?? null,
        uploadedAt: iso(v?.idDocument?.uploadedAt),
      },
      result: v?.verificationResult
        ? {
            faceMatch: v.verificationResult.faceMatch,
            documentValid: v.verificationResult.documentValid,
            reviewRequired: v.verificationResult.reviewRequired,
          }
        : null,
      canProceed: canProceed(v, policy),
      retriesRemaining: Math.max(0, cfg.maxRetries - (v?.retryCount ?? 0)),
      lastError: v?.lastError
        ? {
            code: v.lastError.code,
            message: ERROR_MESSAGES[v.lastError.code] ?? "Please try again.",
          }
        : null,
      limits: {
        maxDocumentBytes: cfg.maxDocumentBytes,
        maxPhotoBytes: cfg.maxPhotoBytes,
        acceptedFormats: [...DOCUMENT_FILE_TYPES],
      },
      retention: {
        documentDays: Math.round(cfg.documentRetentionMs / 86_400_000),
        photoDays: Math.round(cfg.photoRetentionMs / 86_400_000),
      },
      serverTime: now.toISOString(),
    };
  }

  /** Applies one guarded transition + its audit event in a single transaction. */
  async function transition(params: {
    v: IdentityVerificationDoc;
    to: IdentityVerificationStatus;
    actor: { type: IdentityActor; id: ObjectId | null };
    set?: Partial<IdentityVerificationDoc>;
    event: AuditEvent;
    metadata?: Record<string, unknown>;
    ctx: AuditContext;
    now: Date;
    extra?: (session: ClientSession, updated: IdentityVerificationDoc) => Promise<void>;
  }): Promise<IdentityVerificationDoc> {
    assertTransition(params.v.status, params.to, params.actor.type);
    return withTransaction(async (session) => {
      const updated = await verifications.update({
        id: params.v._id,
        expectedVersion: params.v.version,
        expectedStatus: params.v.status,
        set: { ...params.set, status: params.to },
        now: params.now,
        session,
      });
      if (!updated) throw conflict();
      await auditEvent(session, params.event, params.v, params.actor, params.ctx, params.now, {
        fromStatus: params.v.status,
        toStatus: params.to,
        ...params.metadata,
      });
      await params.extra?.(session, updated);
      return updated;
    });
  }

  async function deleteObjectQuietly(reference: string, ids: { attemptId: ObjectId }) {
    try {
      await storage().delete(reference);
    } catch (error) {
      logError("identity object deletion failed", error, {
        attemptId: ids.attemptId.toHexString(),
      });
    }
  }

  async function ensureStarted(
    cx: CandidateContext,
    ctx: AuditContext,
  ): Promise<IdentityVerificationDoc> {
    if (cx.verification) return cx.verification;
    const now = clock();
    const doc: IdentityVerificationDoc = {
      _id: new ObjectId(),
      attemptId: cx.attempt._id,
      candidateId: cx.candidate._id,
      examId: cx.attempt.examId,
      status: S.CAMERA_PENDING,
      version: 1,
      verificationMethod: `photo+document/${provider().name}`,
      capturedAt: null,
      verifiedAt: null,
      photo: null,
      idDocument: null,
      candidateSnapshot: { name: cx.candidate.name, rollNumber: cx.candidate.rollNumber ?? "" },
      verificationResult: null,
      reviewer: null,
      consentAt: null,
      processingStartedAt: null,
      retryCount: 0,
      lastError: null,
      dataExpiresAt: null,
      purgedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await withTransaction(async (session) => {
        await verifications.insert(doc, session);
        await auditEvent(
          session,
          AUDIT_EVENT.IDENTITY_VERIFICATION_STARTED,
          doc,
          { type: "CANDIDATE", id: cx.candidate._id },
          ctx,
          now,
          { fromStatus: S.NOT_STARTED, toStatus: S.CAMERA_PENDING },
        );
      });
      return doc;
    } catch (error) {
      // Concurrent start: the unique attemptId index kept a single record.
      if (error instanceof MongoServerError && error.code === 11000) {
        const existing = await verifications.findByAttempt(cx.attempt._id);
        if (existing) return existing;
      }
      throw error;
    }
  }

  /** Recovers a verification stuck in PROCESSING (e.g. a crash) to manual review. */
  async function recoverStaleProcessing(
    v: IdentityVerificationDoc,
    cx: CandidateContext,
    ctx: AuditContext,
  ) {
    const now = clock();
    if (
      v.status !== S.PROCESSING ||
      !v.processingStartedAt ||
      now.getTime() - v.processingStartedAt.getTime() < config().processingTimeoutMs
    ) {
      return v;
    }
    try {
      return await applyOutcome(
        v,
        cx,
        {
          decision: "REVIEW_REQUIRED",
          faceMatch: null,
          documentValid: null,
          documentReadable: null,
          verificationScore: null,
          reason: "Automated verification did not complete.",
        },
        ctx,
        "recovered",
      );
    } catch {
      return (await verifications.findByAttempt(v.attemptId)) ?? v;
    }
  }

  async function applyOutcome(
    v: IdentityVerificationDoc,
    cx: CandidateContext,
    outcome: VerificationOutcome,
    ctx: AuditContext,
    providerName: string,
  ) {
    const now = clock();
    const event =
      outcome.decision === "VERIFIED"
        ? AUDIT_EVENT.IDENTITY_VERIFIED
        : outcome.decision === "FAILED"
          ? AUDIT_EVENT.IDENTITY_FAILED
          : AUDIT_EVENT.IDENTITY_REVIEW_REQUIRED;
    const allowPending = cx.policy.identityReviewPolicy === "ALLOW_PENDING_REVIEW";

    return transition({
      v,
      to: outcome.decision,
      actor: { type: "SYSTEM", id: null },
      set: {
        verificationResult: {
          faceMatch: outcome.faceMatch,
          documentValid: outcome.documentValid,
          documentReadable: outcome.documentReadable,
          verificationScore: outcome.verificationScore,
          reviewRequired: outcome.decision === "REVIEW_REQUIRED",
          provider: providerName,
          reason: outcome.reason,
        },
        verifiedAt: outcome.decision === "VERIFIED" ? now : null,
        processingStartedAt: null,
      },
      event,
      metadata: { provider: providerName },
      ctx,
      now,
      extra: async (session) => {
        const attemptIdentity =
          outcome.decision === "VERIFIED"
            ? ATTEMPT_IDENTITY_STATUS.VERIFIED
            : outcome.decision === "FAILED"
              ? ATTEMPT_IDENTITY_STATUS.FAILED
              : ATTEMPT_IDENTITY_STATUS.REVIEW_REQUIRED;
        const advance =
          outcome.decision === "VERIFIED" ||
          (outcome.decision === "REVIEW_REQUIRED" && allowPending);
        await c.examAttempts.updateOne(
          { _id: v.attemptId, status: ATTEMPT_STATUS.IDENTITY_VERIFICATION },
          {
            $set: {
              ...(advance ? { status: ATTEMPT_STATUS.READY } : {}),
              identityVerification: {
                status: attemptIdentity,
                completedAt: outcome.decision === "VERIFIED" ? now : null,
              },
              updatedAt: now,
            },
          },
          { session },
        );
      },
    });
  }

  // ─── Candidate operations ─────────────────────────────────────────────────

  return {
    async getStatus(attemptId: string, candidateId: ObjectId, ctx: AuditContext) {
      const cx = await loadCandidateContext(attemptId, candidateId, ctx, { mutate: false });
      await consumeRateLimit(
        db,
        rateLimitKey("status", candidateId, cx.attempt._id),
        config().rateLimits.status,
      );
      const v = cx.verification ? await recoverStaleProcessing(cx.verification, cx, ctx) : null;
      return toStatusResponse(v, cx.policy, clock());
    },

    async start(attemptId: string, candidateId: ObjectId, ctx: AuditContext) {
      const cx = await loadCandidateContext(attemptId, candidateId, ctx, { mutate: true });
      const v = await ensureStarted(cx, ctx);
      return toStatusResponse(v, cx.policy, clock());
    },

    async capturePhoto(
      attemptId: string,
      candidateId: ObjectId,
      bytes: Uint8Array,
      ctx: AuditContext,
    ) {
      const cx = await loadCandidateContext(attemptId, candidateId, ctx, { mutate: true });
      await consumeRateLimit(
        db,
        rateLimitKey("capture", candidateId, cx.attempt._id),
        config().rateLimits.capture,
      );
      const v = await ensureStarted(cx, ctx);

      const target: IdentityVerificationStatus =
        v.status === S.CAMERA_PENDING || v.status === S.PHOTO_CAPTURED
          ? S.PHOTO_CAPTURED
          : v.status;
      assertTransition(v.status, target, "CANDIDATE");
      if (bytes.byteLength > config().maxPhotoBytes) {
        throw new DomainError(API_ERROR.PAYLOAD_TOO_LARGE, 413, "The captured photo is too large.");
      }
      const dims = validatePhoto(bytes);

      const now = clock();
      const sha256 = sha256Hex(bytes);
      const key = newObjectKey("photo");
      let reference: string;
      try {
        ({ reference } = await storage().upload({ key, body: bytes, contentType: "image/jpeg" }));
      } catch (error) {
        logError("photo upload failed", error, { attemptId: cx.attempt._id.toHexString() });
        throw new DomainError(
          API_ERROR.SERVICE_UNAVAILABLE,
          503,
          "We couldn't save your photo. Please try again.",
        );
      }

      const expiresAt = new Date(now.getTime() + config().photoRetentionMs);
      let updated: IdentityVerificationDoc;
      try {
        updated = await transition({
          v,
          to: target,
          actor: { type: "CANDIDATE", id: candidateId },
          set: {
            photo: {
              reference,
              sha256,
              sizeBytes: bytes.byteLength,
              width: dims.width,
              height: dims.height,
              storageProvider: storage().provider,
              capturedAt: now,
              expiresAt,
            },
            capturedAt: now,
            lastError: null,
            dataExpiresAt: minDate(expiresAt, v.idDocument?.expiresAt),
          },
          event: AUDIT_EVENT.CAMERA_CAPTURED,
          metadata: { sizeBytes: bytes.byteLength, replacedPrevious: Boolean(v.photo) },
          ctx,
          now,
        });
      } catch (error) {
        await deleteObjectQuietly(reference, { attemptId: cx.attempt._id }); // don't leave an orphaned copy
        throw error;
      }
      // Only one verification photo is ever retained.
      if (v.photo) await deleteObjectQuietly(v.photo.reference, { attemptId: cx.attempt._id });
      return toStatusResponse(updated, cx.policy, now);
    },

    async uploadDocument(
      attemptId: string,
      candidateId: ObjectId,
      input: {
        bytes: Uint8Array;
        declaredMime: string | null;
        declaredExtension: string | null;
        documentType: string | null;
      },
      ctx: AuditContext,
    ) {
      const cx = await loadCandidateContext(attemptId, candidateId, ctx, { mutate: true });
      await consumeRateLimit(
        db,
        rateLimitKey("document", candidateId, cx.attempt._id),
        config().rateLimits.document,
      );
      const v = cx.verification;
      if (!v || !v.photo) {
        throw new DomainError(
          API_ERROR.INVALID_STATE,
          409,
          "Capture your verification photo before uploading your ID.",
        );
      }
      assertTransition(v.status, S.DOCUMENT_UPLOADED, "CANDIDATE");

      const documentType = input.documentType as IdDocumentType;
      if (!documentType || !(documentType in ID_DOCUMENT_TYPES)) {
        throw new DomainError(
          API_ERROR.VALIDATION_ERROR,
          422,
          "Select the type of ID you're uploading.",
        );
      }
      if (input.bytes.byteLength > config().maxDocumentBytes) {
        throw new DomainError(API_ERROR.PAYLOAD_TOO_LARGE, 413, "This file is too large.");
      }

      const now = clock();
      const recordRejection = async (code: string) => {
        const to = v.status === S.DOCUMENT_UPLOADED ? S.DOCUMENT_UPLOADED : S.DOCUMENT_PENDING;
        await transition({
          v,
          to,
          actor: { type: to === S.DOCUMENT_UPLOADED ? "CANDIDATE" : "SYSTEM", id: candidateId },
          set: { lastError: { code, at: now } },
          event: AUDIT_EVENT.DOCUMENT_REJECTED,
          metadata: { code },
          ctx,
          now,
        }).catch(() => undefined);
      };

      let validated;
      try {
        validated = validateDocument(input);
      } catch (error) {
        if (error instanceof DomainError) await recordRejection(error.code);
        throw error;
      }

      const documentHash = sha256Hex(input.bytes);
      // Duplicate upload of the same file and type: nothing to do.
      if (
        v.idDocument?.documentHash === documentHash &&
        v.idDocument.documentType === documentType
      ) {
        return toStatusResponse(v, cx.policy, now);
      }

      // Scan before the document is stored or used ("quarantine" = in memory only).
      const scan = await scanner().scan(input.bytes);
      if (scan.status === "INFECTED") {
        await withTransaction(async (session) => {
          await auditEvent(
            session,
            AUDIT_EVENT.DOCUMENT_SCAN_COMPLETED,
            v,
            { type: "SYSTEM", id: null },
            ctx,
            now,
            {
              result: "INFECTED",
            },
          );
        });
        await recordRejection(API_ERROR.DOCUMENT_REJECTED);
        throw new DomainError(API_ERROR.DOCUMENT_REJECTED, 422, ERROR_MESSAGES.DOCUMENT_REJECTED);
      }
      if (scan.status === "ERROR") {
        await withTransaction(async (session) => {
          await auditEvent(
            session,
            AUDIT_EVENT.DOCUMENT_SCAN_COMPLETED,
            v,
            { type: "SYSTEM", id: null },
            ctx,
            now,
            {
              result: "SCAN_FAILED",
            },
          );
        });
        throw new DomainError(
          API_ERROR.SERVICE_UNAVAILABLE,
          503,
          "We couldn't process your document right now. Please try again in a moment.",
        );
      }
      const scanStatus = scan.status === "CLEAN" ? SCAN_STATUS.CLEAN : SCAN_STATUS.SCAN_PENDING;

      const key = newObjectKey("document");
      let reference: string;
      try {
        ({ reference } = await storage().upload({
          key,
          body: input.bytes,
          contentType: CONTENT_TYPE[validated.fileType],
        }));
      } catch (error) {
        logError("document upload failed", error, { attemptId: cx.attempt._id.toHexString() });
        throw new DomainError(
          API_ERROR.SERVICE_UNAVAILABLE,
          503,
          "Upload failed. Please try again.",
        );
      }

      const expiresAt = new Date(now.getTime() + config().documentRetentionMs);
      let updated: IdentityVerificationDoc;
      try {
        updated = await transition({
          v,
          to: S.DOCUMENT_UPLOADED,
          actor: { type: "CANDIDATE", id: candidateId },
          set: {
            idDocument: {
              documentType,
              documentReference: reference,
              documentHash,
              fileType: validated.fileType,
              sizeBytes: input.bytes.byteLength,
              storageProvider: storage().provider,
              scanStatus,
              scannedAt: scan.status === "CLEAN" ? now : null,
              uploadedAt: now,
              expiresAt,
            },
            lastError: null,
            dataExpiresAt: minDate(expiresAt, v.photo?.expiresAt),
          },
          event: AUDIT_EVENT.DOCUMENT_UPLOADED,
          metadata: {
            documentType,
            fileType: validated.fileType,
            sizeBytes: input.bytes.byteLength,
            scanStatus,
            replacedPrevious: Boolean(v.idDocument),
          },
          ctx,
          now,
          extra: async (session) => {
            if (scan.status === "CLEAN") {
              await auditEvent(
                session,
                AUDIT_EVENT.DOCUMENT_SCAN_COMPLETED,
                v,
                { type: "SYSTEM", id: null },
                ctx,
                now,
                {
                  result: "CLEAN",
                },
              );
            }
          },
        });
      } catch (error) {
        await deleteObjectQuietly(reference, { attemptId: cx.attempt._id });
        throw error;
      }
      if (v.idDocument)
        await deleteObjectQuietly(v.idDocument.documentReference, { attemptId: cx.attempt._id });
      logEvent("identity document uploaded", {
        attemptId: cx.attempt._id.toHexString(),
        scanStatus,
      });
      return toStatusResponse(updated, cx.policy, now);
    },

    async deleteDocument(attemptId: string, candidateId: ObjectId, ctx: AuditContext) {
      const cx = await loadCandidateContext(attemptId, candidateId, ctx, { mutate: true });
      await consumeRateLimit(
        db,
        rateLimitKey("document", candidateId, cx.attempt._id),
        config().rateLimits.document,
      );
      const v = cx.verification;
      if (!v?.idDocument) {
        throw new DomainError(API_ERROR.INVALID_STATE, 409, "There's no document to remove.");
      }
      assertTransition(v.status, S.DOCUMENT_PENDING, "CANDIDATE");
      // Delete the object first: a retry converges, and data is never kept longer than intended.
      await storage().delete(v.idDocument.documentReference);
      const now = clock();
      const updated = await transition({
        v,
        to: S.DOCUMENT_PENDING,
        actor: { type: "CANDIDATE", id: candidateId },
        set: { idDocument: null, dataExpiresAt: v.photo?.expiresAt ?? null },
        event: AUDIT_EVENT.DOCUMENT_DELETED,
        metadata: { documentType: v.idDocument.documentType },
        ctx,
        now,
      });
      return toStatusResponse(updated, cx.policy, now);
    },

    async verify(
      attemptId: string,
      candidateId: ObjectId,
      body: { consent?: unknown },
      ctx: AuditContext,
    ) {
      const cx = await loadCandidateContext(attemptId, candidateId, ctx, { mutate: true });
      await consumeRateLimit(
        db,
        rateLimitKey("verify", candidateId, cx.attempt._id),
        config().rateLimits.verify,
      );
      // Only consent is read from the body; any client-supplied "result" fields are ignored.
      if (body.consent !== true) {
        throw new DomainError(
          API_ERROR.VALIDATION_ERROR,
          422,
          "Please confirm that the photo and ID belong to you.",
        );
      }
      const v = cx.verification;
      if (!v || v.status === S.PROCESSING) {
        throw new DomainError(API_ERROR.INVALID_STATE, 409, "Verification is already in progress.");
      }
      if (!v.photo || !v.idDocument) {
        throw new DomainError(
          API_ERROR.INVALID_STATE,
          409,
          "Capture your photo and upload your ID first.",
        );
      }
      // Production gate: a document is used for verification only after a clean scan.
      if (config().production && v.idDocument.scanStatus !== SCAN_STATUS.CLEAN) {
        throw new DomainError(
          API_ERROR.INVALID_STATE,
          409,
          "Your document is still being checked. Please try again in a moment.",
        );
      }

      const now = clock();
      // Step 1: lock into PROCESSING (only one concurrent request can win this).
      const processing = await transition({
        v,
        to: S.PROCESSING,
        actor: { type: "CANDIDATE", id: candidateId },
        set: { consentAt: now, processingStartedAt: now },
        event: AUDIT_EVENT.IDENTITY_VERIFICATION_PROCESSING,
        ctx,
        now,
      });

      // Step 2: decide server-side.
      const p = provider();
      let outcome: VerificationOutcome;
      try {
        const [photo, document] = await Promise.all([
          storage().read(processing.photo!.reference),
          storage().read(processing.idDocument!.documentReference),
        ]);
        if (
          sha256Hex(photo) !== processing.photo!.sha256 ||
          sha256Hex(document) !== processing.idDocument!.documentHash
        ) {
          throw new Error("Integrity check failed");
        }
        outcome = await p.evaluate({
          photo,
          document,
          documentFileType: processing.idDocument!.fileType,
          documentScanStatus: processing.idDocument!.scanStatus,
        });
      } catch (error) {
        // Uncertain → human review. Never an automatic failure or accusation.
        logError("automated identity check did not complete", error, {
          attemptId: cx.attempt._id.toHexString(),
        });
        outcome = {
          decision: "REVIEW_REQUIRED",
          faceMatch: null,
          documentValid: null,
          documentReadable: null,
          verificationScore: null,
          reason: "Automated verification did not complete.",
        };
      }

      const final = await applyOutcome(processing, cx, outcome, ctx, p.name);
      const attempt = await c.examAttempts.findOne({ _id: cx.attempt._id });
      return {
        identity: toStatusResponse(final, cx.policy, clock()),
        attemptStatus: attempt!.status,
      };
    },

    async retry(attemptId: string, candidateId: ObjectId, ctx: AuditContext) {
      const cx = await loadCandidateContext(attemptId, candidateId, ctx, { mutate: true });
      await consumeRateLimit(
        db,
        rateLimitKey("retry", candidateId, cx.attempt._id),
        config().rateLimits.retry,
      );
      const v = cx.verification;
      if (!v || v.status !== S.FAILED) {
        throw new DomainError(API_ERROR.INVALID_STATE, 409, "There's nothing to retry right now.");
      }
      if (v.retryCount >= config().maxRetries) {
        throw new DomainError(
          API_ERROR.INVALID_STATE,
          409,
          "No more verification attempts are available. Please contact support.",
        );
      }
      // Previous evidence is deleted before starting over (data minimisation).
      if (v.photo) await storage().delete(v.photo.reference);
      if (v.idDocument) await storage().delete(v.idDocument.documentReference);
      const now = clock();
      const updated = await transition({
        v,
        to: S.CAMERA_PENDING,
        actor: { type: "CANDIDATE", id: candidateId },
        set: {
          photo: null,
          idDocument: null,
          verificationResult: null,
          capturedAt: null,
          consentAt: null,
          lastError: null,
          dataExpiresAt: null,
          retryCount: v.retryCount + 1,
        },
        event: AUDIT_EVENT.IDENTITY_VERIFICATION_RETRY,
        metadata: {
          retryCount: v.retryCount + 1,
          deletedEvidence: Boolean(v.photo || v.idDocument),
        },
        ctx,
        now,
        extra: async (session) => {
          await c.examAttempts.updateOne(
            { _id: v.attemptId, status: ATTEMPT_STATUS.IDENTITY_VERIFICATION },
            {
              $set: {
                identityVerification: {
                  status: ATTEMPT_IDENTITY_STATUS.PENDING,
                  completedAt: null,
                },
                updatedAt: now,
              },
            },
            { session },
          );
        },
      });
      return toStatusResponse(updated, cx.policy, now);
    },

    // ─── Reviewer operations ────────────────────────────────────────────────

    async getForReview(
      verificationIdRaw: string,
      reviewerId: ObjectId,
    ): Promise<IdentityReviewResponse> {
      const { v } = await loadForReviewer(verificationIdRaw, reviewerId);
      return {
        verificationId: v._id.toHexString(),
        attemptId: v.attemptId.toHexString(),
        examId: v.examId.toHexString(),
        status: v.status,
        version: v.version,
        candidate: v.candidateSnapshot,
        photo: {
          present: Boolean(v.photo),
          capturedAt: iso(v.photo?.capturedAt),
          sha256: v.photo?.sha256 ?? null,
        },
        document: {
          present: Boolean(v.idDocument),
          documentType: v.idDocument?.documentType ?? null,
          fileType: v.idDocument?.fileType ?? null,
          scanStatus: v.idDocument?.scanStatus ?? null,
          sha256: v.idDocument?.documentHash ?? null,
          uploadedAt: iso(v.idDocument?.uploadedAt),
        },
        result: v.verificationResult
          ? {
              faceMatch: v.verificationResult.faceMatch,
              documentValid: v.verificationResult.documentValid,
              documentReadable: v.verificationResult.documentReadable,
              verificationScore: v.verificationResult.verificationScore,
              reviewRequired: v.verificationResult.reviewRequired,
              reason: v.verificationResult.reason,
            }
          : null,
        reviewer: v.reviewer
          ? { decision: v.reviewer.decision, reviewedAt: v.reviewer.reviewedAt.toISOString() }
          : null,
      };
    },

    /** Issues a short-lived signed URL for one piece of evidence and records the access. */
    async createAssetAccess(
      verificationIdRaw: string,
      reviewerId: ObjectId,
      asset: unknown,
      ctx: AuditContext,
    ): Promise<AssetAccessResponse> {
      const { v } = await loadForReviewer(verificationIdRaw, reviewerId);
      await consumeRateLimit(
        db,
        `idv:review-access:${reviewerId.toHexString()}`,
        config().rateLimits.reviewAccess,
      );
      if (asset !== "document" && asset !== "photo") {
        throw new DomainError(API_ERROR.VALIDATION_ERROR, 422, "Unknown asset.");
      }
      const target =
        asset === "document"
          ? v.idDocument && {
              reference: v.idDocument.documentReference,
              sha256: v.idDocument.documentHash,
              contentType: CONTENT_TYPE[v.idDocument.fileType],
              scanStatus: v.idDocument.scanStatus,
            }
          : v.photo && {
              reference: v.photo.reference,
              sha256: v.photo.sha256,
              contentType: "image/jpeg",
              scanStatus: null,
            };
      if (!target)
        throw new DomainError(API_ERROR.NOT_FOUND, 404, "This evidence is no longer available.");

      const now = clock();
      const access = await storage().getTemporaryAccess(target.reference, {
        ttlSeconds: config().signedUrlTtlSeconds,
        contentType: target.contentType,
        sha256: target.sha256,
      });
      await withTransaction(async (session) => {
        await auditEvent(
          session,
          asset === "document" ? AUDIT_EVENT.DOCUMENT_VIEWED : AUDIT_EVENT.PHOTO_VIEWED,
          v,
          { type: "REVIEWER", id: reviewerId },
          ctx,
          now,
          { ttlSeconds: config().signedUrlTtlSeconds, scanStatus: target.scanStatus },
        );
      });
      return {
        url: access.url,
        expiresAt: access.expiresAt.toISOString(),
        scanStatus: target.scanStatus,
      };
    },

    /** Reviewer decision with optimistic concurrency: two reviewers can't overwrite each other. */
    async decide(
      verificationIdRaw: string,
      reviewerId: ObjectId,
      input: { decision?: unknown; expectedVersion?: unknown },
      ctx: AuditContext,
    ) {
      const { v } = await loadForReviewer(verificationIdRaw, reviewerId);
      const decision = input.decision as ReviewDecision;
      if (decision !== "APPROVE" && decision !== "REJECT") {
        throw new DomainError(
          API_ERROR.VALIDATION_ERROR,
          422,
          "Decision must be APPROVE or REJECT.",
        );
      }
      if (typeof input.expectedVersion !== "number" || input.expectedVersion !== v.version) {
        throw new DomainError(
          API_ERROR.INVALID_STATE,
          409,
          "This verification was changed by someone else. Reload it before deciding.",
        );
      }
      const now = clock();
      const to = decision === "APPROVE" ? S.VERIFIED : S.FAILED;
      const updated = await transition({
        v,
        to,
        actor: { type: "REVIEWER", id: reviewerId },
        set: {
          reviewer: { reviewerId, reviewedAt: now, decision },
          verifiedAt: decision === "APPROVE" ? now : null,
        },
        event: decision === "APPROVE" ? AUDIT_EVENT.IDENTITY_VERIFIED : AUDIT_EVENT.IDENTITY_FAILED,
        metadata: { decision },
        ctx,
        now,
        extra: async (session) => {
          await c.examAttempts.updateOne(
            { _id: v.attemptId },
            [
              {
                $set: {
                  identityVerification: {
                    status:
                      decision === "APPROVE"
                        ? ATTEMPT_IDENTITY_STATUS.VERIFIED
                        : ATTEMPT_IDENTITY_STATUS.FAILED,
                    completedAt: decision === "APPROVE" ? now : null,
                  },
                  status: {
                    $cond: [
                      {
                        $and: [
                          { $eq: ["$status", ATTEMPT_STATUS.IDENTITY_VERIFICATION] },
                          { $eq: [decision, "APPROVE"] },
                        ],
                      },
                      ATTEMPT_STATUS.READY,
                      "$status",
                    ],
                  },
                  updatedAt: now,
                },
              },
            ],
            { session },
          );
        },
      });
      return { status: updated.status, version: updated.version };
    },

    // ─── Retention ──────────────────────────────────────────────────────────

    /** Deletes evidence past its retention deadline and records each purge. */
    async purgeExpired(ctx: AuditContext = { ipAddress: null, userAgent: null }) {
      const now = clock();
      const due = await verifications.findDueForPurge(now);
      let purged = 0;
      for (const v of due) {
        const photoDue = v.photo && v.photo.expiresAt <= now;
        const docDue = v.idDocument && v.idDocument.expiresAt <= now;
        if (photoDue) await storage().delete(v.photo!.reference);
        if (docDue) await storage().delete(v.idDocument!.documentReference);
        const remainingPhoto = photoDue ? null : v.photo;
        const remainingDoc = docDue ? null : v.idDocument;
        await withTransaction(async (session) => {
          await c.identityVerifications.updateOne(
            { _id: v._id },
            {
              $set: {
                photo: remainingPhoto,
                idDocument: remainingDoc,
                dataExpiresAt: minDate(remainingPhoto?.expiresAt, remainingDoc?.expiresAt),
                purgedAt: remainingPhoto || remainingDoc ? null : now,
                updatedAt: now,
              },
              $inc: { version: 1 },
            },
            { session },
          );
          await auditEvent(
            session,
            AUDIT_EVENT.IDENTITY_DATA_PURGED,
            v,
            { type: "SYSTEM", id: null },
            ctx,
            now,
            {
              photo: Boolean(photoDue),
              document: Boolean(docDue),
            },
          );
        });
        purged++;
      }
      return { purged };
    },
  };

  async function loadForReviewer(verificationIdRaw: string, reviewerId: ObjectId) {
    const reviewer = await users.findActiveStaff(reviewerId);
    if (!reviewer) {
      throw new DomainError(API_ERROR.FORBIDDEN, 403, "You don't have access to identity reviews.");
    }
    if (!/^[a-f\d]{24}$/i.test(verificationIdRaw))
      throw new DomainError(API_ERROR.NOT_FOUND, 404, "Not found.");
    const v = await verifications.findById(new ObjectId(verificationIdRaw));
    if (!v) throw new DomainError(API_ERROR.NOT_FOUND, 404, "Not found.");
    if (reviewer.role !== USER_ROLE.ADMIN) {
      const exam = await c.exams.findOne({ _id: v.examId, examinerIds: reviewer._id });
      // Not assigned to this exam → indistinguishable from "doesn't exist".
      if (!exam) throw new DomainError(API_ERROR.NOT_FOUND, 404, "Not found.");
    }
    return { v, reviewer };
  }
}
export type IdentityVerificationService = ReturnType<typeof createIdentityVerificationService>;

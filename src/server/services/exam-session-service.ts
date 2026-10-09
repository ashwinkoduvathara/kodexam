import "@tanstack/react-start/server-only";
import { ObjectId, MongoServerError, type Db } from "mongodb";
import { API_ERROR, type ExamAttemptResponse, type ExamSessionResponse } from "@/types/api";
import { DEFAULT_EXAM_INSTRUCTIONS, EXAM_STATUS, type ProctoringPolicy } from "@/types/exam";
import {
  ATTEMPT_STATUS,
  CHECK_RESULT,
  IDENTITY_STATUS,
  PRE_EXAM_STATUSES,
  SYSTEM_CHECK_IDS,
  isTerminalStatus,
  type AttemptStatus,
  type CheckResult,
  type SystemCheckKey,
} from "@/types/exam-attempt";
import {
  AUDIT_EVENT,
  getCollections,
  type ExamAttemptDoc,
  type ExamDoc,
  type ExamSessionDoc,
  type UserDoc,
} from "../db/collections";
import { inTransactionIfSupported } from "../db/transactions";
import { closeAttemptIfDue } from "./attempt-closure";
import { DomainError, attemptExpired, attemptNotFound, unauthenticated } from "../errors";
import { createAuditLogRepository, type AuditContext } from "../repositories/audit-log-repository";
import { createExamAttemptRepository } from "../repositories/exam-attempt-repository";
import { createExamRepository } from "../repositories/exam-repository";
import { createExamSessionRepository } from "../repositories/exam-session-repository";
import { createUserRepository } from "../repositories/user-repository";

/** Statuses from which the pre-exam system check may be (re)submitted. */
const SYSTEM_CHECK_ALLOWED: readonly AttemptStatus[] = [
  ATTEMPT_STATUS.SYSTEM_CHECK,
  ATTEMPT_STATUS.INSTRUCTIONS,
  ATTEMPT_STATUS.IDENTITY_VERIFICATION,
  ATTEMPT_STATUS.READY,
];
const SATISFIED_RESULTS: readonly CheckResult[] = [CHECK_RESULT.PASSED, CHECK_RESULT.WARNING];

export function requiredChecksFor(policy: ProctoringPolicy): SystemCheckKey[] {
  return SYSTEM_CHECK_IDS.filter((id) => {
    if (id === "camera") return policy.cameraRequired;
    if (id === "microphone") return policy.microphoneRequired;
    return true; // speaker + network are always required
  });
}

export function isExamOpen(exam: ExamDoc, now: Date): boolean {
  return exam.status === EXAM_STATUS.PUBLISHED && exam.startAt <= now && now < exam.endAt;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Why an attempt may not start yet, re-checked on the server regardless of its status. */
export function startBlocker(attempt: ExamAttemptDoc, policy: ProctoringPolicy | undefined) {
  if (!attempt.systemCheck.completedAt) return "Complete the system check before starting.";
  if (!attempt.instructionsAcknowledgedAt) {
    return "Acknowledge the exam instructions before starting.";
  }
  const identity = attempt.identityVerification.status;
  const identityOk =
    identity === IDENTITY_STATUS.VERIFIED ||
    (identity === IDENTITY_STATUS.NOT_REQUIRED && policy?.identityVerificationRequired === false) ||
    (identity === IDENTITY_STATUS.REVIEW_REQUIRED &&
      policy?.identityReviewPolicy === "ALLOW_PENDING_REVIEW");
  if (!identityOk) return "Your identity verification must be completed before starting.";
  return null;
}

/**
 * Server-authoritative exam session logic. Candidate identity is always passed
 * in from the authenticated request — never taken from the request body.
 */
export function createExamSessionService(db: Db, clock: () => Date = () => new Date()) {
  const users = createUserRepository(db);
  const exams = createExamRepository(db);
  const attempts = createExamAttemptRepository(db);
  const sessions = createExamSessionRepository(db);
  const audit = createAuditLogRepository(db);

  async function requireCandidate(candidateId: ObjectId): Promise<UserDoc> {
    const candidate = await users.findActiveCandidate(candidateId);
    if (!candidate) throw unauthenticated();
    return candidate;
  }

  /**
   * `scope` is the exam an LMS-launched session was issued for: such a session
   * can't open or start any other exam. Unscoped sessions exist only in development.
   */
  async function requireExam(examRef: string, scope?: ObjectId | null): Promise<ExamDoc> {
    const exam = await exams.findByRef(examRef);
    if (!exam || exam.status === EXAM_STATUS.DRAFT) {
      throw new DomainError(API_ERROR.NOT_FOUND, 404, "This exam could not be found.");
    }
    if (scope && !exam._id.equals(scope)) {
      throw new DomainError(
        API_ERROR.FORBIDDEN,
        403,
        "Open this exam from your Kodeversity dashboard.",
      );
    }
    return exam;
  }

  async function requireOwnedAttempt(attemptId: string, candidateId: ObjectId) {
    if (!ObjectId.isValid(attemptId) || !/^[a-f\d]{24}$/i.test(attemptId)) throw attemptNotFound();
    const attempt = await attempts.findOwned(new ObjectId(attemptId), candidateId);
    if (!attempt) throw attemptNotFound();
    return attempt;
  }

  /**
   * Lazily closes attempts whose server deadline has passed (the scheduled
   * expiry worker does the same without any request — see jobs/expiry-worker.ts).
   */
  async function applyExpiry(attempt: ExamAttemptDoc, ctx: AuditContext, now: Date) {
    if (attempt.expiresAt > now) return attempt;
    return (await closeAttemptIfDue(db, attempt, { now, ctx, closedBy: "REQUEST" })).attempt;
  }

  async function snapshotFor(exam: ExamDoc, attempt: ExamAttemptDoc, now: Date) {
    const doc: ExamSessionDoc = {
      _id: new ObjectId(),
      attemptId: attempt._id,
      examId: exam._id,
      candidateId: attempt.candidateId,
      examEndTime: attempt.expiresAt,
      requiredChecks: requiredChecksFor(exam.proctoringPolicy),
      proctoringPolicy: exam.proctoringPolicy,
      securityPolicy: exam.securityPolicy,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    };
    return sessions.ensure(doc);
  }

  function toSessionResponse(
    exam: ExamDoc,
    candidate: UserDoc,
    attempt: ExamAttemptDoc,
    snapshot: ExamSessionDoc,
    now: Date,
  ): ExamSessionResponse {
    return {
      exam: {
        id: exam._id.toHexString(),
        code: exam.examCode,
        name: exam.name,
        description: exam.description,
        durationMinutes: exam.durationMinutes,
        totalQuestions: exam.totalQuestions,
        totalMarks: exam.totalMarks,
        passingMarks: exam.passingMarks,
        attemptLimit: exam.attemptLimit,
        instructions: exam.instructions.length ? exam.instructions : DEFAULT_EXAM_INSTRUCTIONS,
      },
      candidate: {
        id: candidate._id.toHexString(),
        name: candidate.name,
        rollNumber: candidate.rollNumber ?? "",
        avatarUrl: candidate.avatarUrl,
      },
      attempt: {
        id: attempt._id.toHexString(),
        attemptNumber: attempt.attemptNumber,
        status: attempt.status,
        startedAt: attempt.startedAt.toISOString(),
        examStartedAt: iso(attempt.examStartedAt ?? null),
        expiresAt: attempt.expiresAt.toISOString(),
        systemCheckCompletedAt: iso(attempt.systemCheck.completedAt),
        instructionsAcknowledgedAt: iso(attempt.instructionsAcknowledgedAt),
        identityVerificationStatus: attempt.identityVerification.status,
        identityVerificationCompletedAt: iso(attempt.identityVerification.completedAt),
      },
      proctoringPolicy: snapshot.proctoringPolicy,
      securityPolicy: snapshot.securityPolicy,
      requiredChecks: snapshot.requiredChecks,
      serverTime: now.toISOString(),
    };
  }

  async function buildSession(attempt: ExamAttemptDoc, candidate: UserDoc, now: Date) {
    const exam = await exams.findById(attempt.examId);
    if (!exam) throw attemptNotFound();
    const snapshot = await snapshotFor(exam, attempt, now);
    return toSessionResponse(exam, candidate, attempt, snapshot, now);
  }

  /** Re-reads after a failed conditional update to explain why it didn't apply. */
  async function explainRejectedTransition(attemptId: ObjectId, candidateId: ObjectId, now: Date) {
    const current = await attempts.findOwned(attemptId, candidateId);
    if (!current) return attemptNotFound();
    if (current.expiresAt <= now) return attemptExpired();
    return new DomainError(
      API_ERROR.INVALID_STATE,
      409,
      "Your exam progress changed. Reload the page to continue.",
    );
  }

  return {
    /** GET /api/exams/:examId/session — the candidate's latest attempt on this exam. */
    async getSession(
      examRef: string,
      candidateId: ObjectId,
      ctx: AuditContext,
      scope?: ObjectId | null,
    ) {
      const now = clock();
      const candidate = await requireCandidate(candidateId);
      const exam = await requireExam(examRef, scope);
      const latest = await attempts.findLatest(exam._id, candidate._id);
      if (!latest) {
        if (!isExamOpen(exam, now)) {
          throw new DomainError(API_ERROR.EXAM_NOT_ACTIVE, 403, "This exam isn't open right now.");
        }
        throw new DomainError(API_ERROR.NO_ATTEMPT, 404, "No attempt has been started yet.");
      }
      if (exam.status !== EXAM_STATUS.PUBLISHED) {
        throw new DomainError(API_ERROR.EXAM_NOT_ACTIVE, 403, "This exam is no longer available.");
      }
      const attempt = await applyExpiry(latest, ctx, now);
      return buildSession(attempt, candidate, now);
    },

    /** POST /api/exams/:examId/attempts — idempotent: returns the open attempt if one exists. */
    async startAttempt(
      examRef: string,
      candidateId: ObjectId,
      ctx: AuditContext,
      scope?: ObjectId | null,
    ) {
      const now = clock();
      const candidate = await requireCandidate(candidateId);
      const exam = await requireExam(examRef, scope);
      if (!isExamOpen(exam, now)) {
        throw new DomainError(API_ERROR.EXAM_NOT_ACTIVE, 403, "This exam isn't open right now.");
      }

      const latest = await attempts.findLatest(exam._id, candidate._id);
      if (latest) {
        const current = await applyExpiry(latest, ctx, now);
        if (
          PRE_EXAM_STATUSES.includes(current.status) ||
          current.status === ATTEMPT_STATUS.IN_PROGRESS
        ) {
          return buildSession(current, candidate, now);
        }
      }
      const attemptNumber = (latest?.attemptNumber ?? 0) + 1;
      if (attemptNumber > exam.attemptLimit) {
        throw new DomainError(
          API_ERROR.ATTEMPT_LIMIT_REACHED,
          409,
          "You have used all attempts allowed for this exam.",
        );
      }

      // The exam timer doesn't run during setup (system check, instructions,
      // identity). Until the exam starts, the attempt only ends with the exam window.
      const attempt: ExamAttemptDoc = {
        _id: new ObjectId(),
        examId: exam._id,
        candidateId: candidate._id,
        attemptNumber,
        status: ATTEMPT_STATUS.SYSTEM_CHECK,
        startedAt: now,
        examStartedAt: null,
        expiresAt: exam.endAt,
        submittedAt: null,
        cancelledAt: null,
        systemCheck: {
          camera: CHECK_RESULT.NOT_RUN,
          microphone: CHECK_RESULT.NOT_RUN,
          speaker: CHECK_RESULT.NOT_RUN,
          network: CHECK_RESULT.NOT_RUN,
          completedAt: null,
        },
        instructionsAcknowledgedAt: null,
        identityVerification: {
          status: exam.proctoringPolicy.identityVerificationRequired
            ? IDENTITY_STATUS.PENDING
            : IDENTITY_STATUS.NOT_REQUIRED,
          completedAt: null,
        },
        createdAt: now,
        updatedAt: now,
      };

      try {
        await attempts.insert(attempt);
      } catch (error) {
        // A concurrent request created this attempt first — return that one.
        if (error instanceof MongoServerError && error.code === 11000) {
          const winner = await attempts.findLatest(exam._id, candidate._id);
          if (winner) return buildSession(winner, candidate, now);
        }
        throw error;
      }
      await audit.record({
        eventType: AUDIT_EVENT.ATTEMPT_STARTED,
        actorType: "CANDIDATE",
        actorId: candidate._id,
        attemptId: attempt._id,
        examId: exam._id,
        candidateId: candidate._id,
        context: ctx,
        metadata: { attemptNumber },
        at: now,
      });
      return buildSession(attempt, candidate, now);
    },

    /** GET /api/exam-attempts/:attemptId */
    async getAttempt(attemptId: string, candidateId: ObjectId, ctx: AuditContext) {
      const now = clock();
      await requireCandidate(candidateId);
      const attempt = await applyExpiry(
        await requireOwnedAttempt(attemptId, candidateId),
        ctx,
        now,
      );
      const response: ExamAttemptResponse = {
        id: attempt._id.toHexString(),
        examId: attempt.examId.toHexString(),
        attemptNumber: attempt.attemptNumber,
        status: attempt.status,
        startedAt: attempt.startedAt.toISOString(),
        examStartedAt: iso(attempt.examStartedAt ?? null),
        expiresAt: attempt.expiresAt.toISOString(),
        submittedAt: iso(attempt.submittedAt),
        systemCheck: { ...attempt.systemCheck, completedAt: iso(attempt.systemCheck.completedAt) },
        instructionsAcknowledgedAt: iso(attempt.instructionsAcknowledgedAt),
        identityVerification: {
          status: attempt.identityVerification.status,
          completedAt: iso(attempt.identityVerification.completedAt),
        },
      };
      return response;
    },

    /** POST /api/exam-attempts/:attemptId/system-check */
    async completeSystemCheck(
      attemptId: string,
      candidateId: ObjectId,
      results: Partial<Record<string, unknown>>,
      ctx: AuditContext,
    ) {
      const now = clock();
      const candidate = await requireCandidate(candidateId);
      const attempt = await applyExpiry(
        await requireOwnedAttempt(attemptId, candidateId),
        ctx,
        now,
      );
      if (attempt.status === ATTEMPT_STATUS.EXPIRED) throw attemptExpired();
      if (!SYSTEM_CHECK_ALLOWED.includes(attempt.status)) {
        throw new DomainError(API_ERROR.INVALID_STATE, 409, "The system check is already closed.");
      }

      const snapshot = await sessions.findByAttempt(attempt._id);
      const required = snapshot?.requiredChecks ?? SYSTEM_CHECK_IDS.slice();
      const known = Object.values(CHECK_RESULT) as string[];
      const normalized = Object.fromEntries(
        SYSTEM_CHECK_IDS.map((id) => {
          const value = results[id];
          return [
            id,
            typeof value === "string" && known.includes(value) ? value : CHECK_RESULT.NOT_RUN,
          ];
        }),
      ) as Record<SystemCheckKey, CheckResult>;
      const failing = required.filter((id) => !SATISFIED_RESULTS.includes(normalized[id]));
      if (failing.length) {
        throw new DomainError(
          API_ERROR.VALIDATION_ERROR,
          422,
          `These checks must pass before continuing: ${failing.join(", ")}.`,
        );
      }

      const updated = await attempts.transition({
        attemptId: attempt._id,
        candidateId,
        from: [attempt.status],
        now,
        set: {
          systemCheck: { ...normalized, completedAt: now },
          status:
            attempt.status === ATTEMPT_STATUS.SYSTEM_CHECK
              ? ATTEMPT_STATUS.INSTRUCTIONS
              : attempt.status,
        },
      });
      if (!updated) throw await explainRejectedTransition(attempt._id, candidateId, now);

      await audit.record({
        eventType: AUDIT_EVENT.SYSTEM_CHECK_COMPLETED,
        actorType: "CANDIDATE",
        actorId: candidateId,
        attemptId: updated._id,
        examId: updated.examId,
        candidateId,
        context: ctx,
        metadata: { results: normalized },
        at: now,
      });
      return buildSession(updated, candidate, now);
    },

    /** POST /api/exam-attempts/:attemptId/instructions/acknowledge */
    async acknowledgeInstructions(attemptId: string, candidateId: ObjectId, ctx: AuditContext) {
      const now = clock();
      const candidate = await requireCandidate(candidateId);
      const attempt = await applyExpiry(
        await requireOwnedAttempt(attemptId, candidateId),
        ctx,
        now,
      );
      if (attempt.status === ATTEMPT_STATUS.EXPIRED) throw attemptExpired();

      // Idempotent retry (e.g. a double click or a lost response): already acknowledged.
      if (attempt.instructionsAcknowledgedAt && attempt.status !== ATTEMPT_STATUS.INSTRUCTIONS) {
        if (PRE_EXAM_STATUSES.includes(attempt.status)) {
          return buildSession(attempt, candidate, now);
        }
      }
      if (attempt.status !== ATTEMPT_STATUS.INSTRUCTIONS) {
        throw new DomainError(
          API_ERROR.INVALID_STATE,
          409,
          attempt.status === ATTEMPT_STATUS.SYSTEM_CHECK
            ? "Complete the system check before acknowledging the instructions."
            : "The instructions can't be acknowledged at this stage.",
        );
      }

      const snapshot = await sessions.findByAttempt(attempt._id);
      const identityRequired = snapshot?.proctoringPolicy.identityVerificationRequired ?? true;
      const updated = await attempts.transition({
        attemptId: attempt._id,
        candidateId,
        from: [ATTEMPT_STATUS.INSTRUCTIONS],
        now,
        set: {
          instructionsAcknowledgedAt: now,
          status: identityRequired ? ATTEMPT_STATUS.IDENTITY_VERIFICATION : ATTEMPT_STATUS.READY,
        },
      });
      if (!updated) throw await explainRejectedTransition(attempt._id, candidateId, now);

      await audit.record({
        eventType: AUDIT_EVENT.INSTRUCTIONS_ACKNOWLEDGED,
        actorType: "CANDIDATE",
        actorId: candidateId,
        attemptId: updated._id,
        examId: updated.examId,
        candidateId,
        context: ctx,
        at: now,
      });
      return buildSession(updated, candidate, now);
    },

    /**
     * POST /api/exam-attempts/:attemptId/start-exam — READY → IN_PROGRESS.
     * This is the only place the exam timer starts:
     * expiresAt = min(now + duration, exam.endAt). Idempotent once started.
     * The start time, duration and deadline never come from the request.
     */
    async startExam(attemptId: string, candidateId: ObjectId, ctx: AuditContext) {
      const now = clock();
      const candidate = await requireCandidate(candidateId);
      const attempt = await applyExpiry(
        await requireOwnedAttempt(attemptId, candidateId),
        ctx,
        now,
      );
      if (attempt.status === ATTEMPT_STATUS.EXPIRED) throw attemptExpired();
      // A repeat (double click, lost response) returns the running exam; the deadline is unchanged.
      if (attempt.status === ATTEMPT_STATUS.IN_PROGRESS) {
        return buildSession(attempt, candidate, now);
      }
      if (attempt.status !== ATTEMPT_STATUS.READY) {
        throw new DomainError(
          API_ERROR.INVALID_STATE,
          409,
          "Complete the pre-exam steps before starting the exam.",
        );
      }
      // Defence in depth: READY already implies these, but re-check the recorded facts.
      const snapshot = await sessions.findByAttempt(attempt._id);
      const blocker = startBlocker(attempt, snapshot?.proctoringPolicy);
      if (blocker) throw new DomainError(API_ERROR.INVALID_STATE, 409, blocker);

      const exam = await exams.findById(attempt.examId);
      if (!exam || !isExamOpen(exam, now)) {
        throw new DomainError(API_ERROR.EXAM_NOT_ACTIVE, 403, "This exam is no longer available.");
      }

      const deadline = new Date(
        Math.min(now.getTime() + exam.durationMinutes * 60_000, exam.endAt.getTime()),
      );
      // The status change, the snapshot deadline and the audit event commit together.
      // The conditional READY -> IN_PROGRESS update means only one request can ever start it.
      const updated = await inTransactionIfSupported(async (session) => {
        const started = await attempts.transition({
          attemptId: attempt._id,
          candidateId,
          from: [ATTEMPT_STATUS.READY],
          now,
          set: { status: ATTEMPT_STATUS.IN_PROGRESS, examStartedAt: now, expiresAt: deadline },
          session,
        });
        if (!started) return null;
        await sessions.setExamEndTime(started._id, deadline, now, session);
        await audit.record(
          {
            eventType: AUDIT_EVENT.EXAM_STARTED,
            actorType: "CANDIDATE",
            actorId: candidateId,
            attemptId: started._id,
            examId: started.examId,
            candidateId,
            context: ctx,
            metadata: { durationMinutes: exam.durationMinutes, expiresAt: deadline.toISOString() },
            at: now,
          },
          session,
        );
        return started;
      });
      if (!updated) {
        // A concurrent request started it first — return the running exam.
        const current = await attempts.findOwned(attempt._id, candidateId);
        if (current?.status === ATTEMPT_STATUS.IN_PROGRESS) {
          return buildSession(current, candidate, now);
        }
        throw await explainRejectedTransition(attempt._id, candidateId, now);
      }
      return buildSession(updated, candidate, now);
    },

    /**
     * The running attempt, for the question/answer API. Applies the server-side
     * timeout first, so a request after the deadline sees the closed attempt.
     */
    async requireActiveAttempt(attemptId: string, candidateId: ObjectId, ctx: AuditContext) {
      const now = clock();
      await requireCandidate(candidateId);
      const attempt = await applyExpiry(
        await requireOwnedAttempt(attemptId, candidateId),
        ctx,
        now,
      );
      if (
        attempt.status === ATTEMPT_STATUS.SUBMITTED ||
        attempt.status === ATTEMPT_STATUS.AUTO_SUBMITTED
      ) {
        throw new DomainError(
          API_ERROR.ATTEMPT_SUBMITTED,
          409,
          "This exam has been submitted. Answers can no longer be changed.",
        );
      }
      if (attempt.status === ATTEMPT_STATUS.EXPIRED) throw attemptExpired();
      if (attempt.status !== ATTEMPT_STATUS.IN_PROGRESS) {
        throw new DomainError(
          API_ERROR.INVALID_STATE,
          409,
          attempt.status === ATTEMPT_STATUS.CANCELLED
            ? "This exam attempt has ended."
            : "This exam hasn't started yet.",
        );
      }
      return attempt;
    },

    /**
     * POST /api/exam-attempts/:attemptId/submit — the candidate submits (End Exam).
     * Idempotent: a closed attempt returns its final state. Saved answers are
     * what's submitted; the status change and audit event commit together.
     */
    async submitExam(attemptId: string, candidateId: ObjectId, ctx: AuditContext) {
      const now = clock();
      const candidate = await requireCandidate(candidateId);
      const attempt = await applyExpiry(
        await requireOwnedAttempt(attemptId, candidateId),
        ctx,
        now,
      );
      if (isTerminalStatus(attempt.status)) return buildSession(attempt, candidate, now);
      if (attempt.status !== ATTEMPT_STATUS.IN_PROGRESS) {
        throw new DomainError(API_ERROR.INVALID_STATE, 409, "This exam hasn't started yet.");
      }

      const answered = await getCollections(db).candidateAnswers.countDocuments({
        attemptId: attempt._id,
        "selectedOptionIds.0": { $exists: true },
      });
      const updated = await inTransactionIfSupported(async (session) => {
        const submitted = await attempts.transition({
          attemptId: attempt._id,
          candidateId,
          from: [ATTEMPT_STATUS.IN_PROGRESS],
          now,
          set: { status: ATTEMPT_STATUS.SUBMITTED, submittedAt: now, closedReason: "CANDIDATE" },
          session,
        });
        if (!submitted) return null;
        await audit.record(
          {
            eventType: AUDIT_EVENT.EXAM_SUBMITTED,
            actorType: "CANDIDATE",
            actorId: candidateId,
            attemptId: submitted._id,
            examId: submitted.examId,
            candidateId,
            context: ctx,
            metadata: { reason: "CANDIDATE", answeredCount: answered },
            at: now,
          },
          session,
        );
        return submitted;
      });
      if (!updated) {
        // A concurrent submit (or the timeout) closed it first: report the final state.
        const current = await applyExpiry(
          (await attempts.findOwned(attempt._id, candidateId)) ?? attempt,
          ctx,
          clock(),
        );
        if (isTerminalStatus(current.status)) return buildSession(current, candidate, now);
        throw await explainRejectedTransition(attempt._id, candidateId, now);
      }
      return buildSession(updated, candidate, now);
    },

    /** POST /api/exam-attempts/:attemptId/end — candidate leaves before answering. */
    async endAttempt(attemptId: string, candidateId: ObjectId, ctx: AuditContext) {
      const now = clock();
      const candidate = await requireCandidate(candidateId);
      const attempt = await applyExpiry(
        await requireOwnedAttempt(attemptId, candidateId),
        ctx,
        now,
      );
      if (attempt.status === ATTEMPT_STATUS.EXPIRED) throw attemptExpired();
      if (!PRE_EXAM_STATUSES.includes(attempt.status)) {
        throw new DomainError(
          API_ERROR.INVALID_STATE,
          409,
          "This attempt can no longer be ended here.",
        );
      }

      const updated = await attempts.transition({
        attemptId: attempt._id,
        candidateId,
        from: PRE_EXAM_STATUSES,
        now,
        set: { status: ATTEMPT_STATUS.CANCELLED, cancelledAt: now },
      });
      if (!updated) throw await explainRejectedTransition(attempt._id, candidateId, now);

      await audit.record({
        eventType: AUDIT_EVENT.ATTEMPT_CANCELLED,
        actorType: "CANDIDATE",
        actorId: candidateId,
        attemptId: updated._id,
        examId: updated.examId,
        candidateId,
        context: ctx,
        metadata: { fromStatus: attempt.status },
        at: now,
      });
      return buildSession(updated, candidate, now);
    },
  };
}
export type ServerExamSessionService = ReturnType<typeof createExamSessionService>;

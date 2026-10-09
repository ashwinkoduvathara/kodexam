import "@tanstack/react-start/server-only";
import type { Db } from "mongodb";
import { ATTEMPT_STATUS, PRE_EXAM_STATUSES } from "@/types/exam-attempt";
import { AUDIT_EVENT, getCollections, type ExamAttemptDoc } from "../db/collections";
import { inTransactionIfSupported } from "../db/transactions";
import { createAuditLogRepository, type AuditContext } from "../repositories/audit-log-repository";

/** Who noticed the deadline: a request for the attempt, or the scheduled worker. */
export type ClosedBy = "REQUEST" | "EXPIRY_WORKER";

/**
 * Closes an attempt whose server deadline has passed — the single place this
 * happens, used both by API requests (lazily) and by the expiry worker.
 *
 * - IN_PROGRESS → AUTO_SUBMITTED (or EXPIRED when the exam's frozen policy
 *   disables auto-submit). `submittedAt` is the deadline: answers saved before
 *   it are what count, and the answer API refuses writes from that moment.
 * - Pre-exam (setup) → EXPIRED.
 *
 * The status change is conditional (still open AND past the deadline) and is
 * committed together with its audit event, so however many requests and
 * workers race, an attempt is closed — and audited — exactly once.
 * Returns the attempt as stored afterwards and whether this call closed it.
 */
export async function closeAttemptIfDue(
  db: Db,
  attempt: ExamAttemptDoc,
  opts: { now: Date; ctx: AuditContext; closedBy: ClosedBy },
): Promise<{ attempt: ExamAttemptDoc; changed: boolean }> {
  const { now, ctx, closedBy } = opts;
  const c = getCollections(db);
  const running = attempt.status === ATTEMPT_STATUS.IN_PROGRESS;
  const preExam = PRE_EXAM_STATUSES.includes(attempt.status);
  if (attempt.expiresAt > now || (!running && !preExam)) return { attempt, changed: false };

  const snapshot = running
    ? await c.examSessions.findOne(
        { attemptId: attempt._id },
        { projection: { securityPolicy: 1 } },
      )
    : null;
  const autoSubmit = running && (snapshot?.securityPolicy.autoSubmitOnExpiry ?? true);
  const delaySeconds = Math.max(
    0,
    Math.round((now.getTime() - attempt.expiresAt.getTime()) / 1000),
  );
  const audit = createAuditLogRepository(db);

  const closed = await inTransactionIfSupported(async (session) => {
    const updated = await c.examAttempts.findOneAndUpdate(
      {
        _id: attempt._id,
        status: running ? ATTEMPT_STATUS.IN_PROGRESS : { $in: [...PRE_EXAM_STATUSES] },
        expiresAt: { $lte: now },
      },
      {
        $set: {
          status: autoSubmit ? ATTEMPT_STATUS.AUTO_SUBMITTED : ATTEMPT_STATUS.EXPIRED,
          ...(autoSubmit ? { submittedAt: attempt.expiresAt } : {}),
          closedReason: "TIME_LIMIT",
          updatedAt: now,
        },
        $unset: { expiryLease: "" },
      },
      { returnDocument: "after", session },
    );
    if (!updated) return null;
    await audit.record(
      {
        eventType: autoSubmit ? AUDIT_EVENT.EXAM_AUTO_SUBMITTED : AUDIT_EVENT.ATTEMPT_EXPIRED,
        actorType: "SYSTEM",
        actorId: null,
        attemptId: attempt._id,
        examId: attempt.examId,
        candidateId: attempt.candidateId,
        context: ctx,
        metadata: {
          reason: "TIME_LIMIT",
          phase: running ? "EXAM" : "SETUP",
          deadline: attempt.expiresAt.toISOString(),
          closedBy,
          delaySeconds,
        },
        at: now,
      },
      session,
    );
    return updated;
  });

  if (closed) return { attempt: closed, changed: true };
  // Someone else closed it (or it changed) first: report what is stored now.
  const current = await c.examAttempts.findOne({ _id: attempt._id });
  return { attempt: current ?? attempt, changed: false };
}

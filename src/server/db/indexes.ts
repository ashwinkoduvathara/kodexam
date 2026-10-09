import "@tanstack/react-start/server-only";
import { LAUNCH_TOKENS_COLLECTION } from "../auth/lms-launch";
import type { Collection, Db, Document } from "mongodb";
import { RATE_LIMIT_COLLECTION } from "../rate-limiter";
import { getCollections } from "./collections";

/** Drops an index by name if it exists (used to retire superseded indexes). */
async function dropIndexIfExists(collection: Collection<Document>, name: string) {
  const exists = await collection.indexExists(name).catch(() => false);
  if (exists) await collection.dropIndex(name);
}

/**
 * Indexes derived from the actual query patterns. Idempotent — run by
 * `npm run db:indexes` / `npm run db:seed`, never on the request path.
 * No index is ever created on a sensitive field.
 */
export async function ensureIndexes(
  db: Db,
  options: { auditRetentionDays?: number | null } = {},
): Promise<void> {
  const c = getCollections(db);

  // Retired index definitions (superseded below).
  await dropIndexIfExists(c.auditLogs as unknown as Collection<Document>, "attempt_createdAt");
  await dropIndexIfExists(
    c.identityVerifications as unknown as Collection<Document>,
    "attempt_createdAt_desc",
  );

  await Promise.all([
    // Candidate lookup by roll number / email (both optional, so partial).
    c.users.createIndex(
      { rollNumber: 1 },
      {
        name: "rollNumber_unique",
        unique: true,
        partialFilterExpression: { rollNumber: { $type: "string" } },
      },
    ),
    c.users.createIndex(
      { email: 1 },
      {
        name: "email_unique",
        unique: true,
        partialFilterExpression: { email: { $type: "string" } },
      },
    ),

    // Exams are addressed by code in the LMS and URLs.
    c.exams.createIndex({ examCode: 1 }, { name: "examCode_unique", unique: true }),

    // "Latest attempt for this candidate on this exam" (sort attemptNumber desc).
    // Unique: two concurrent "start attempt" requests can't create the same attempt twice.
    c.examAttempts.createIndex(
      { examId: 1, candidateId: 1, attemptNumber: 1 },
      { name: "exam_candidate_attempt_unique", unique: true },
    ),
    // "Active attempts for a candidate" across exams.
    c.examAttempts.createIndex({ candidateId: 1, status: 1 }, { name: "candidate_status" }),

    // One frozen session snapshot per attempt.
    c.examSessions.createIndex({ attemptId: 1 }, { name: "attemptId_unique", unique: true }),

    // Audit trail of an attempt, newest first.
    c.auditLogs.createIndex({ attemptId: 1, timestamp: -1 }, { name: "attempt_timestamp_desc" }),

    // One identity verification per attempt (also prevents duplicates under concurrency).
    c.identityVerifications.createIndex(
      { attemptId: 1 },
      { name: "attemptId_unique", unique: true },
    ),
    // A candidate's verifications, newest first.
    c.identityVerifications.createIndex(
      { candidateId: 1, createdAt: -1 },
      { name: "candidate_createdAt_desc" },
    ),
    // Reviewer queue: an exam's verifications awaiting review.
    c.identityVerifications.createIndex({ examId: 1, status: 1 }, { name: "exam_status" }),
    // Retention purge: records holding data past its retention deadline.
    c.identityVerifications.createIndex(
      { dataExpiresAt: 1 },
      { name: "dataExpiresAt", partialFilterExpression: { dataExpiresAt: { $type: "date" } } },
    ),

    // Questions of an exam in display order.
    c.questions.createIndex({ examId: 1, order: 1 }, { name: "exam_order_unique", unique: true }),
    // Proctoring timeline of an attempt.
    c.proctoringEvents.createIndex({ attemptId: 1, occurredAt: 1 }, { name: "attempt_occurredAt" }),
    // LMS launch: candidate by LMS user id; used launch-token ids expire by TTL.
    c.users.createIndex(
      { lmsUserId: 1 },
      {
        name: "lmsUserId_unique",
        unique: true,
        partialFilterExpression: { lmsUserId: { $type: "string" } },
      },
    ),
    db
      .collection(LAUNCH_TOKENS_COLLECTION)
      .createIndex({ expiresAt: 1 }, { name: "expiresAt_ttl", expireAfterSeconds: 0 }),
    // Expiry worker: open attempts by deadline.
    c.examAttempts.createIndex({ status: 1, expiresAt: 1 }, { name: "status_expiresAt" }),
    c.candidateAnswers.createIndex(
      { attemptId: 1, questionId: 1 },
      { name: "attempt_question_unique", unique: true },
    ),
    // A candidate's tickets, newest first.
    c.supportTickets.createIndex(
      { candidateId: 1, createdAt: -1 },
      { name: "candidate_createdAt_desc" },
    ),

    // Rate-limit counters disappear after their window.
    db
      .collection(RATE_LIMIT_COLLECTION)
      .createIndex({ expiresAt: 1 }, { name: "expiresAt_ttl", expireAfterSeconds: 0 }),
  ]);

  // Optional audit retention (organisation policy). Unset = keep audit logs.
  const auditLogs = c.auditLogs as unknown as Collection<Document>;
  if (options.auditRetentionDays) {
    const seconds = Math.round(options.auditRetentionDays * 86_400);
    const existing = (await auditLogs.indexes()).find((i) => i.name === "timestamp_ttl");
    if (existing && existing.expireAfterSeconds !== seconds) {
      await db.command({
        collMod: "auditLogs",
        index: { name: "timestamp_ttl", expireAfterSeconds: seconds },
      });
    } else if (!existing) {
      await auditLogs.createIndex(
        { timestamp: 1 },
        { name: "timestamp_ttl", expireAfterSeconds: seconds },
      );
    }
  } else {
    await dropIndexIfExists(auditLogs, "timestamp_ttl");
  }
}

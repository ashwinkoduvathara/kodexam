import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import type { ExamSessionResponse } from "@/types/api";
import { getCollections, type ExamDoc, type UserDoc } from "../db/collections";
import { closeMongoClient } from "../db/mongodb";
import { ALL_PASSED, apiRequest, createCandidate, createExam, resetTestDb } from "../test/fixtures";
import {
  acknowledgeInstructions,
  endExamAttempt,
  startExam,
  getExamAttempt,
  getExamSession,
  startExamAttempt,
  submitSystemCheck,
} from "./exam-api";

let db: Db;
let candidate: UserDoc;
let exam: ExamDoc;

async function body<T = ExamSessionResponse>(res: Response) {
  return (await res.json()) as T;
}

/** Starts an attempt and completes the system check → status INSTRUCTIONS. */
async function attemptAtInstructions(who = candidate, onExam = exam) {
  const start = await body(
    await startExamAttempt(
      apiRequest(`/api/exams/${onExam._id}/attempts`, { method: "POST", candidate: who }),
      onExam._id.toHexString(),
    ),
  );
  const res = await submitSystemCheck(
    apiRequest(`/api/exam-attempts/${start.attempt.id}/system-check`, {
      method: "POST",
      candidate: who,
      body: { results: ALL_PASSED },
    }),
    start.attempt.id,
  );
  expect(res.status).toBe(200);
  return start.attempt.id;
}

beforeEach(async () => {
  db = await resetTestDb();
  candidate = await createCandidate(db, { name: "Asha Menon", rollNumber: "RN-555" });
  exam = await createExam(db, { examCode: "DS-7319", name: "Distributed Systems" });
});

afterAll(async () => {
  await (await resetTestDb()).dropDatabase();
  await closeMongoClient();
});

describe("GET /api/exams/:examId/session", () => {
  it("rejects requests without an authenticated candidate", async () => {
    const res = await getExamSession(
      apiRequest(`/api/exams/${exam._id}/session`),
      exam._id.toHexString(),
    );
    expect(res.status).toBe(401);
    expect((await body<{ error: { code: string } }>(res)).error.code).toBe("UNAUTHENTICATED");
  });

  it("reports NO_ATTEMPT before the first attempt is started", async () => {
    const res = await getExamSession(
      apiRequest(`/api/exams/${exam._id}/session`, { candidate }),
      exam._id.toHexString(),
    );
    expect(res.status).toBe(404);
    expect((await body<{ error: { code: string } }>(res)).error.code).toBe("NO_ATTEMPT");
  });

  it("loads the session from MongoDB: exam, candidate, attempt and server deadline", async () => {
    await startExamAttempt(
      apiRequest(`/api/exams/${exam._id}/attempts`, { method: "POST", candidate }),
      exam._id.toHexString(),
    );
    const res = await getExamSession(
      apiRequest(`/api/exams/${exam._id}/session`, { candidate }),
      exam._id.toHexString(),
    );
    expect(res.status).toBe(200);
    const session = await body(res);
    expect(session.exam).toMatchObject({
      code: "DS-7319",
      name: "Distributed Systems",
      durationMinutes: 75,
      totalQuestions: 42,
      totalMarks: 120,
      passingMarks: 48,
    });
    expect(session.candidate).toMatchObject({ name: "Asha Menon", rollNumber: "RN-555" });
    expect(session.attempt.status).toBe("SYSTEM_CHECK");

    const stored = await getCollections(db).examAttempts.findOne({});
    expect(session.attempt.expiresAt).toBe(stored!.expiresAt.toISOString());
    // The exam timer hasn't started: during setup the attempt is bounded only by the exam window.
    expect(session.attempt.examStartedAt).toBeNull();
    expect(stored!.expiresAt.getTime()).toBe(exam.endAt.getTime());
  });
});

describe("POST /api/exams/:examId/attempts", () => {
  it("is idempotent under concurrent requests", async () => {
    const make = () =>
      startExamAttempt(
        apiRequest(`/api/exams/${exam._id}/attempts`, { method: "POST", candidate }),
        exam._id.toHexString(),
      );
    const results = await Promise.all([make(), make(), make()]);
    const ids = new Set(await Promise.all(results.map(async (r) => (await body(r)).attempt.id)));
    expect(ids.size).toBe(1);
    expect(await getCollections(db).examAttempts.countDocuments()).toBe(1);
  });

  it("enforces the attempt limit", async () => {
    const attemptId = await attemptAtInstructions();
    await endExamAttempt(
      apiRequest(`/api/exam-attempts/${attemptId}/end`, { method: "POST", candidate }),
      attemptId,
    );
    const res = await startExamAttempt(
      apiRequest(`/api/exams/${exam._id}/attempts`, { method: "POST", candidate }),
      exam._id.toHexString(),
    );
    expect(res.status).toBe(409);
    expect((await body<{ error: { code: string } }>(res)).error.code).toBe("ATTEMPT_LIMIT_REACHED");
  });

  it("refuses exams outside their window", async () => {
    const closed = await createExam(db, { endAt: new Date(Date.now() - 1000) });
    const res = await startExamAttempt(
      apiRequest(`/api/exams/${closed._id}/attempts`, { method: "POST", candidate }),
      closed._id.toHexString(),
    );
    expect(res.status).toBe(403);
  });

  it("blocks cross-origin requests (CSRF)", async () => {
    const res = await startExamAttempt(
      apiRequest(`/api/exams/${exam._id}/attempts`, {
        method: "POST",
        candidate,
        origin: "https://evil.example",
      }),
      exam._id.toHexString(),
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /api/exam-attempts/:attemptId/system-check", () => {
  it("rejects results where a required check didn't pass", async () => {
    const start = await body(
      await startExamAttempt(
        apiRequest(`/api/exams/${exam._id}/attempts`, { method: "POST", candidate }),
        exam._id.toHexString(),
      ),
    );
    const res = await submitSystemCheck(
      apiRequest(`/api/exam-attempts/${start.attempt.id}/system-check`, {
        method: "POST",
        candidate,
        body: { results: { ...ALL_PASSED, camera: "failed" } },
      }),
      start.attempt.id,
    );
    expect(res.status).toBe(422);
  });

  it("records results and moves the attempt to INSTRUCTIONS", async () => {
    const attemptId = await attemptAtInstructions();
    const attempt = await getCollections(db).examAttempts.findOne({});
    expect(attempt!.status).toBe("INSTRUCTIONS");
    expect(attempt!.systemCheck.camera).toBe("passed");
    expect(attempt!.systemCheck.completedAt).toBeInstanceOf(Date);
    expect(attemptId).toBe(attempt!._id.toHexString());
  });
});

describe("POST /api/exam-attempts/:attemptId/instructions/acknowledge", () => {
  const ack = (attemptId: string, who: UserDoc = candidate) =>
    acknowledgeInstructions(
      apiRequest(`/api/exam-attempts/${attemptId}/instructions/acknowledge`, {
        method: "POST",
        candidate: who,
      }),
      attemptId,
      { ipAddress: "203.0.113.7" },
    );

  it("persists the acknowledgement, advances the status and writes an audit event", async () => {
    const attemptId = await attemptAtInstructions();
    const before = Date.now();
    const res = await ack(attemptId);
    expect(res.status).toBe(200);
    const session = await body(res);
    expect(session.attempt.status).toBe("IDENTITY_VERIFICATION");

    const c = getCollections(db);
    const attempt = await c.examAttempts.findOne({});
    expect(attempt!.status).toBe("IDENTITY_VERIFICATION");
    expect(attempt!.instructionsAcknowledgedAt).toBeInstanceOf(Date);
    expect(attempt!.instructionsAcknowledgedAt!.getTime()).toBeGreaterThanOrEqual(before - 5);
    expect(session.attempt.instructionsAcknowledgedAt).toBe(
      attempt!.instructionsAcknowledgedAt!.toISOString(),
    );

    const events = await c.auditLogs.find({ eventType: "INSTRUCTIONS_ACKNOWLEDGED" }).toArray();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      attemptId: attempt!._id,
      candidateId: candidate._id,
      ipAddress: "203.0.113.7",
      userAgent: "vitest-agent",
    });
    expect(events[0].timestamp).toBeInstanceOf(Date);
    expect(events[0].actorType).toBe("CANDIDATE");
  });

  it("moves to READY when identity verification isn't required", async () => {
    const noId = await createExam(db, {
      proctoringPolicy: { ...exam.proctoringPolicy, identityVerificationRequired: false },
    });
    const attemptId = await attemptAtInstructions(candidate, noId);
    expect((await body(await ack(attemptId))).attempt.status).toBe("READY");
  });

  it("refuses an expired attempt and marks it EXPIRED", async () => {
    const attemptId = await attemptAtInstructions();
    const c = getCollections(db);
    await c.examAttempts.updateOne({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await ack(attemptId);
    expect(res.status).toBe(409);
    expect((await body<{ error: { code: string } }>(res)).error.code).toBe("ATTEMPT_EXPIRED");
    const attempt = await c.examAttempts.findOne({});
    expect(attempt!.status).toBe("EXPIRED");
    expect(attempt!.instructionsAcknowledgedAt).toBeNull();
    expect(await c.auditLogs.countDocuments({ eventType: "INSTRUCTIONS_ACKNOWLEDGED" })).toBe(0);
  });

  it("doesn't let another candidate modify the attempt", async () => {
    const attemptId = await attemptAtInstructions();
    const intruder = await createCandidate(db, { name: "Someone Else" });

    const res = await ack(attemptId, intruder);
    expect(res.status).toBe(404);
    const attempt = await getCollections(db).examAttempts.findOne({});
    expect(attempt!.status).toBe("INSTRUCTIONS");
    expect(attempt!.instructionsAcknowledgedAt).toBeNull();

    const read = await getExamAttempt(
      apiRequest(`/api/exam-attempts/${attemptId}`, { candidate: intruder }),
      attemptId,
    );
    expect(read.status).toBe(404);
  });

  it("refuses to acknowledge before the system check", async () => {
    const start = await body(
      await startExamAttempt(
        apiRequest(`/api/exams/${exam._id}/attempts`, { method: "POST", candidate }),
        exam._id.toHexString(),
      ),
    );
    const res = await ack(start.attempt.id);
    expect(res.status).toBe(409);
    expect((await body<{ error: { code: string } }>(res)).error.code).toBe("INVALID_STATE");
  });

  it("handles concurrent/duplicate submissions with a single audit event", async () => {
    const attemptId = await attemptAtInstructions();
    const results = await Promise.all([ack(attemptId), ack(attemptId), ack(attemptId)]);
    for (const r of results) expect([200, 409]).toContain(r.status);
    expect(results.some((r) => r.status === 200)).toBe(true);
    expect(
      await getCollections(db).auditLogs.countDocuments({ eventType: "INSTRUCTIONS_ACKNOWLEDGED" }),
    ).toBe(1);
    // A later retry is idempotent.
    expect((await ack(attemptId)).status).toBe(200);
  });
});

describe("POST /api/exam-attempts/:attemptId/end", () => {
  it("cancels the attempt and records it", async () => {
    const attemptId = await attemptAtInstructions();
    const res = await endExamAttempt(
      apiRequest(`/api/exam-attempts/${attemptId}/end`, { method: "POST", candidate }),
      attemptId,
    );
    expect(res.status).toBe(200);
    const c = getCollections(db);
    expect((await c.examAttempts.findOne({}))!.status).toBe("CANCELLED");
    expect(await c.auditLogs.countDocuments({ eventType: "ATTEMPT_CANCELLED" })).toBe(1);
  });
});

describe("POST /api/exam-attempts/:attemptId/start-exam", () => {
  const start = (attemptId: string, who: UserDoc = candidate) =>
    startExam(
      apiRequest(`/api/exam-attempts/${attemptId}/start-exam`, { method: "POST", candidate: who }),
      attemptId,
    );

  /** An attempt at READY (identity not required), opened `setupMinutes` ago. */
  async function attemptAtReady(setupMinutes = 0, overrides: Partial<ExamDoc> = {}) {
    const noId = await createExam(db, {
      proctoringPolicy: { ...exam.proctoringPolicy, identityVerificationRequired: false },
      ...overrides,
    });
    const attemptId = await attemptAtInstructions(candidate, noId);
    await acknowledgeInstructions(
      apiRequest(`/api/exam-attempts/${attemptId}/instructions/acknowledge`, {
        method: "POST",
        candidate,
      }),
      attemptId,
    );
    if (setupMinutes) {
      // Simulate a long setup: the attempt was opened well before the exam starts.
      await getCollections(db).examAttempts.updateOne(
        {},
        { $set: { startedAt: new Date(Date.now() - setupMinutes * 60_000) } },
      );
    }
    return { attemptId, exam: noId };
  }

  it("starts the timer only now: full duration regardless of time spent on setup", async () => {
    const { attemptId } = await attemptAtReady(40);
    const before = Date.now();
    const res = await start(attemptId);
    expect(res.status).toBe(200);
    const session = await body(res);
    expect(session.attempt.status).toBe("IN_PROGRESS");

    const c = getCollections(db);
    const stored = await c.examAttempts.findOne({});
    const startedExam = stored!.examStartedAt!.getTime();
    expect(startedExam).toBeGreaterThanOrEqual(before - 5);
    expect(stored!.expiresAt.getTime()).toBe(startedExam + 75 * 60_000);
    expect(session.attempt.examStartedAt).toBe(stored!.examStartedAt!.toISOString());
    expect(session.attempt.expiresAt).toBe(stored!.expiresAt.toISOString());
    expect((await c.examSessions.findOne({}))!.examEndTime.getTime()).toBe(
      stored!.expiresAt.getTime(),
    );

    const events = await c.auditLogs.find({ eventType: "EXAM_STARTED" }).toArray();
    expect(events).toHaveLength(1);
    expect(events[0].metadata).toMatchObject({ durationMinutes: 75 });
  });

  it("never runs past the exam window", async () => {
    const endAt = new Date(Date.now() + 20 * 60_000);
    const { attemptId } = await attemptAtReady(0, { endAt });
    expect((await start(attemptId)).status).toBe(200);
    const stored = await getCollections(db).examAttempts.findOne({});
    expect(stored!.expiresAt.getTime()).toBe(endAt.getTime());
  });

  it("is idempotent: a repeat keeps the original deadline and audits once", async () => {
    const { attemptId } = await attemptAtReady();
    const results = await Promise.all([start(attemptId), start(attemptId), start(attemptId)]);
    for (const r of results) expect(r.status).toBe(200);
    const c = getCollections(db);
    const first = (await c.examAttempts.findOne({}))!.expiresAt.getTime();
    expect((await start(attemptId)).status).toBe(200);
    expect((await c.examAttempts.findOne({}))!.expiresAt.getTime()).toBe(first);
    expect(await c.auditLogs.countDocuments({ eventType: "EXAM_STARTED" })).toBe(1);
  });

  it("refuses to start before the pre-exam steps are complete", async () => {
    const attemptId = await attemptAtInstructions();
    const res = await start(attemptId);
    expect(res.status).toBe(409);
    expect((await body<{ error: { code: string } }>(res)).error.code).toBe("INVALID_STATE");
    const stored = await getCollections(db).examAttempts.findOne({});
    expect(stored!.status).toBe("INSTRUCTIONS");
    expect(stored!.examStartedAt ?? null).toBeNull();
  });

  it("doesn't let another candidate start the exam", async () => {
    const { attemptId } = await attemptAtReady();
    const intruder = await createCandidate(db, { name: "Someone Else" });
    expect((await start(attemptId, intruder)).status).toBe(404);
    expect((await getCollections(db).examAttempts.findOne({}))!.status).toBe("READY");
  });

  it("ignores timing values sent by the browser", async () => {
    const { attemptId } = await attemptAtReady();
    const res = await startExam(
      apiRequest(`/api/exam-attempts/${attemptId}/start-exam`, {
        method: "POST",
        candidate,
        body: {
          startedAt: "2020-01-01T00:00:00.000Z",
          expiresAt: "2099-01-01T00:00:00.000Z",
          durationMinutes: 999,
        },
      }),
      attemptId,
    );
    expect(res.status).toBe(200);
    const stored = await getCollections(db).examAttempts.findOne({});
    expect(Math.abs(stored!.examStartedAt!.getTime() - Date.now())).toBeLessThan(5_000);
    expect(stored!.expiresAt.getTime()).toBe(stored!.examStartedAt!.getTime() + 75 * 60_000);
  });

  it("re-checks identity on the server even when the attempt says READY", async () => {
    // Identity-required exam, BLOCK policy: force READY while identity is still under review.
    const attemptId = await attemptAtInstructions();
    await acknowledgeInstructions(
      apiRequest(`/api/exam-attempts/${attemptId}/instructions/acknowledge`, {
        method: "POST",
        candidate,
      }),
      attemptId,
    );
    const c = getCollections(db);
    await c.examAttempts.updateOne(
      {},
      { $set: { status: "READY", "identityVerification.status": "REVIEW_REQUIRED" } },
    );
    const res = await start(attemptId);
    expect(res.status).toBe(409);
    expect((await body<{ error: { code: string } }>(res)).error.code).toBe("INVALID_STATE");
    expect((await c.examAttempts.findOne({}))!.status).toBe("READY");
    expect(await c.auditLogs.countDocuments({ eventType: "EXAM_STARTED" })).toBe(0);
  });

  it("allows a pending review only when the exam's policy permits it", async () => {
    const lenient = await createExam(db, {
      proctoringPolicy: { ...exam.proctoringPolicy, identityReviewPolicy: "ALLOW_PENDING_REVIEW" },
    });
    const attemptId = await attemptAtInstructions(candidate, lenient);
    await acknowledgeInstructions(
      apiRequest(`/api/exam-attempts/${attemptId}/instructions/acknowledge`, {
        method: "POST",
        candidate,
      }),
      attemptId,
    );
    await getCollections(db).examAttempts.updateOne(
      {},
      { $set: { status: "READY", "identityVerification.status": "REVIEW_REQUIRED" } },
    );
    expect((await start(attemptId)).status).toBe(200);
  });

  it("refuses when the exam is no longer available", async () => {
    const { attemptId, exam: noId } = await attemptAtReady();
    await getCollections(db).exams.updateOne({ _id: noId._id }, { $set: { status: "ARCHIVED" } });
    const res = await start(attemptId);
    expect(res.status).toBe(403);
    expect((await body<{ error: { code: string } }>(res)).error.code).toBe("EXAM_NOT_ACTIVE");
    expect((await getCollections(db).examAttempts.findOne({}))!.status).toBe("READY");
  });

  it("re-reading the session after the start never resets the deadline", async () => {
    const { attemptId, exam: noId } = await attemptAtReady();
    const started = await body(await start(attemptId));
    const read = async () =>
      body(
        await getExamSession(
          apiRequest(`/api/exams/${noId._id}/session`, { candidate }),
          noId._id.toHexString(),
        ),
      );
    const first = await read();
    await new Promise((r) => setTimeout(r, 1100));
    const second = await read();
    expect(first.attempt.status).toBe("IN_PROGRESS");
    expect(first.attempt.expiresAt).toBe(started.attempt.expiresAt);
    expect(second.attempt.expiresAt).toBe(started.attempt.expiresAt);
    expect(second.attempt.examStartedAt).toBe(started.attempt.examStartedAt);
  });

  it("refuses once the exam window has closed", async () => {
    const { attemptId } = await attemptAtReady();
    await getCollections(db).examAttempts.updateOne(
      {},
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    const res = await start(attemptId);
    expect(res.status).toBe(409);
    expect((await body<{ error: { code: string } }>(res)).error.code).toBe("ATTEMPT_EXPIRED");
  });
});

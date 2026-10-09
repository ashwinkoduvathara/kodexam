import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { ExamSessionResponse } from "@/types/api";
import { getCollections, type ExamAttemptDoc, type ExamDoc, type UserDoc } from "../db/collections";
import { closeMongoClient } from "../db/mongodb";
import { createExamPaperService } from "../services/exam-paper-service";
import {
  ALL_PASSED,
  apiRequest,
  createCandidate,
  createExam,
  createQuestions,
  resetTestDb,
} from "../test/fixtures";
import {
  acknowledgeInstructions,
  startExam,
  startExamAttempt,
  submitSystemCheck,
} from "../api/exam-api";
import { getJobHealth } from "../ops/health";
import { recordWorkerRun, runExpirySweep, type SweepResult } from "./expiry-worker";

let db: Db;
let exam: ExamDoc;
const config = { batchSize: 500, leaseSeconds: 60 };
const ctx = { ipAddress: null, userAgent: "vitest" };

const post = (path: string, who: UserDoc, body: unknown = {}) =>
  apiRequest(path, { method: "POST", candidate: who, body });

/** A real attempt started through the API (exam without identity verification). */
async function runningAttempt(who: UserDoc, onExam = exam) {
  const s = (await (
    await startExamAttempt(post(`/api/exams/${onExam._id}/attempts`, who), onExam._id.toHexString())
  ).json()) as ExamSessionResponse;
  const id = s.attempt.id;
  await submitSystemCheck(
    post(`/api/exam-attempts/${id}/system-check`, who, { results: ALL_PASSED }),
    id,
  );
  await acknowledgeInstructions(post(`/api/exam-attempts/${id}/instructions/acknowledge`, who), id);
  await startExam(post(`/api/exam-attempts/${id}/start-exam`, who), id);
  return new ObjectId(id);
}

/** Inserts `n` IN_PROGRESS attempts already past their deadline (bulk, for concurrency tests). */
async function overdueAttempts(n: number, secondsAgo = 30) {
  const c = getCollections(db);
  const now = Date.now();
  const docs: ExamAttemptDoc[] = Array.from({ length: n }, (_, i) => ({
    _id: new ObjectId(),
    examId: exam._id,
    candidateId: new ObjectId(),
    attemptNumber: 1,
    status: "IN_PROGRESS",
    startedAt: new Date(now - 3600_000),
    examStartedAt: new Date(now - 3000_000),
    expiresAt: new Date(now - secondsAgo * 1000 - i),
    submittedAt: null,
    cancelledAt: null,
    systemCheck: {
      camera: "passed",
      microphone: "passed",
      speaker: "passed",
      network: "passed",
      completedAt: new Date(now - 3500_000),
    },
    instructionsAcknowledgedAt: new Date(now - 3400_000),
    identityVerification: { status: "NOT_REQUIRED", completedAt: null },
    createdAt: new Date(now - 3600_000),
    updatedAt: new Date(now - 3000_000),
  }));
  await c.examAttempts.insertMany(docs);
  await c.examSessions.insertMany(
    docs.map((d) => ({
      _id: new ObjectId(),
      attemptId: d._id,
      examId: exam._id,
      candidateId: d.candidateId,
      examEndTime: d.expiresAt,
      requiredChecks: [],
      proctoringPolicy: exam.proctoringPolicy,
      securityPolicy: exam.securityPolicy,
      lastSeenAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  );
  return docs.map((d) => d._id);
}

const sweep = (workerId = "w1", clock?: () => Date) =>
  runExpirySweep(db, { workerId, config, clock });

beforeEach(async () => {
  db = await resetTestDb();
  exam = await createExam(db, {
    proctoringPolicy: {
      cameraRequired: true,
      microphoneRequired: true,
      screenMonitoringRequired: false,
      fullscreenRequired: true,
      identityVerificationRequired: false,
    },
  });
  await createQuestions(db, exam, 3);
});

afterAll(async () => {
  await (await resetTestDb()).dropDatabase();
  await closeMongoClient();
});

describe("expiry worker", () => {
  it("auto-submits a running exam past its deadline with no browser activity", async () => {
    const candidate = await createCandidate(db);
    const id = await runningAttempt(candidate);
    const c = getCollections(db);
    const deadline = new Date(Date.now() - 5000);
    await c.examAttempts.updateOne({ _id: id }, { $set: { expiresAt: deadline } });

    const result = await sweep();
    expect(result).toMatchObject({ claimed: 1, closed: 1, failed: 0, overdue: 0 });
    const stored = await c.examAttempts.findOne({ _id: id });
    expect(stored).toMatchObject({ status: "AUTO_SUBMITTED", closedReason: "TIME_LIMIT" });
    expect(stored!.submittedAt!.getTime()).toBe(deadline.getTime());
    expect(stored!.expiryLease).toBeUndefined();
    const audits = await c.auditLogs
      .find({ attemptId: id, eventType: "EXAM_AUTO_SUBMITTED" })
      .toArray();
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata).toMatchObject({ closedBy: "EXPIRY_WORKER", reason: "TIME_LIMIT" });
    expect(audits[0].metadata.delaySeconds).toBeGreaterThanOrEqual(5);
  });

  it("respects an exam that disables auto-submit (expires instead)", async () => {
    exam = await createExam(db, {
      securityPolicy: { ...exam.securityPolicy, autoSubmitOnExpiry: false },
      proctoringPolicy: exam.proctoringPolicy,
    });
    const id = await runningAttempt(await createCandidate(db), exam);
    await getCollections(db).examAttempts.updateOne(
      { _id: id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    await sweep();
    const stored = await getCollections(db).examAttempts.findOne({ _id: id });
    expect(stored!.status).toBe("EXPIRED");
    expect(stored!.submittedAt).toBeNull();
  });

  it("expires setups whose exam window has closed, and leaves open attempts alone", async () => {
    const c = getCollections(db);
    const due = await runningAttempt(await createCandidate(db, { name: "Due" }));
    const notDue = await runningAttempt(await createCandidate(db, { name: "Not due" }));
    await c.examAttempts.updateOne(
      { _id: due },
      { $set: { status: "INSTRUCTIONS", expiresAt: new Date(Date.now() - 1000) } },
    );
    const result = await sweep();
    expect(result.closed).toBe(1);
    expect((await c.examAttempts.findOne({ _id: due }))!.status).toBe("EXPIRED");
    expect((await c.examAttempts.findOne({ _id: notDue }))!.status).toBe("IN_PROGRESS");
  });

  it("multiple workers racing close every attempt exactly once", async () => {
    const ids = await overdueAttempts(30);
    const results = await Promise.all(["a", "b", "c", "d"].map((w) => sweep(w)));
    const c = getCollections(db);
    expect(results.reduce((n, r) => n + r.closed, 0)).toBe(30);
    expect(results.reduce((n, r) => n + r.failed, 0)).toBe(0);
    expect(
      await c.examAttempts.countDocuments({ _id: { $in: ids }, status: "AUTO_SUBMITTED" }),
    ).toBe(30);
    const audits = await c.auditLogs
      .aggregate<{ _id: ObjectId; n: number }>([
        { $match: { eventType: "EXAM_AUTO_SUBMITTED" } },
        { $group: { _id: "$attemptId", n: { $sum: 1 } } },
      ])
      .toArray();
    expect(audits).toHaveLength(30);
    expect(audits.every((a) => a.n === 1)).toBe(true);
  });

  it("a duplicate run is a no-op", async () => {
    await overdueAttempts(5);
    expect((await sweep()).closed).toBe(5);
    const again = await sweep();
    expect(again).toMatchObject({ claimed: 0, closed: 0 });
    expect(
      await getCollections(db).auditLogs.countDocuments({ eventType: "EXAM_AUTO_SUBMITTED" }),
    ).toBe(5);
  });

  it("a failed close keeps its lease, is skipped until the lease expires, then retried once", async () => {
    const [id] = await overdueAttempts(1);
    let calls = 0;
    const failing: typeof import("../services/attempt-closure").closeAttemptIfDue = async () => {
      calls += 1;
      throw Object.assign(new Error("simulated outage"), { name: "MongoNetworkError" });
    };
    const first = await runExpirySweep(db, { workerId: "w1", config, close: failing });
    expect(first).toMatchObject({ claimed: 1, failed: 1, closed: 0 });
    const c = getCollections(db);
    expect((await c.examAttempts.findOne({ _id: id }))!.expiryLease?.by).toBe("w1");

    // Another worker inside the lease window doesn't touch it (no double processing).
    expect((await sweep("w2")).claimed).toBe(0);

    // After the lease expires, any worker retries it — and it is closed exactly once.
    const later = () => new Date(Date.now() + 61_000);
    const retried = await sweep("w2", later);
    expect(retried).toMatchObject({ claimed: 1, closed: 1 });
    expect(calls).toBe(1);
    expect((await c.examAttempts.findOne({ _id: id }))!.status).toBe("AUTO_SUBMITTED");
    expect(await c.auditLogs.countDocuments({ attemptId: id })).toBe(1);
  });

  it("answer writes racing the deadline are refused; earlier answers are kept", async () => {
    const candidate = await createCandidate(db);
    const id = await runningAttempt(candidate);
    const paper = createExamPaperService(db);
    const questions = await getCollections(db).questions.find({ examId: exam._id }).toArray();
    // Saved before the deadline.
    await paper.saveAnswer(
      id.toHexString(),
      questions[0]._id.toHexString(),
      candidate._id,
      {
        selectedOptionId: "a",
        expectedVersion: 0,
      },
      ctx,
    );
    await getCollections(db).examAttempts.updateOne(
      { _id: id },
      { $set: { expiresAt: new Date(Date.now() - 1) } },
    );
    // The browser is still open and keeps saving while the worker runs.
    const writes = questions.slice(1).map((q) =>
      paper
        .saveAnswer(
          id.toHexString(),
          q._id.toHexString(),
          candidate._id,
          {
            selectedOptionId: "b",
            expectedVersion: 0,
          },
          ctx,
        )
        .then(
          () => "saved",
          (e: { code?: string }) => e.code,
        ),
    );
    const [, ...outcomes] = await Promise.all([sweep(), ...writes]);
    expect(outcomes.every((o) => o === "ATTEMPT_SUBMITTED")).toBe(true);
    const answers = await getCollections(db).candidateAnswers.find({ attemptId: id }).toArray();
    expect(answers).toHaveLength(1);
    expect(answers[0].selectedOptionIds).toEqual(["a"]);
  });
});

describe("audit consistency", () => {
  it("every status change in a lifecycle has exactly one matching audit event", async () => {
    const c = getCollections(db);
    const submitted = await runningAttempt(await createCandidate(db, { name: "Submits" }));
    const { submitExam } = await import("../api/exam-api");
    const who = await c.users.findOne({ name: "Submits" });
    await submitExam(post(`/api/exam-attempts/${submitted}/submit`, who!), submitted.toHexString());
    const timedOut = await runningAttempt(await createCandidate(db, { name: "Times out" }));
    await c.examAttempts.updateOne(
      { _id: timedOut },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    await sweep();
    await sweep(); // duplicate run adds nothing

    const events = async (attemptId: ObjectId) =>
      (await c.auditLogs.find({ attemptId }).sort({ timestamp: 1 }).toArray()).map(
        (a) => a.eventType,
      );
    expect(await events(submitted)).toEqual([
      "ATTEMPT_STARTED",
      "SYSTEM_CHECK_COMPLETED",
      "INSTRUCTIONS_ACKNOWLEDGED",
      "EXAM_STARTED",
      "EXAM_SUBMITTED",
    ]);
    expect((await events(timedOut)).filter((e) => e === "EXAM_AUTO_SUBMITTED")).toHaveLength(1);
    // Closed attempts and closing audit events agree one-to-one.
    const closed = await c.examAttempts.countDocuments({
      status: { $in: ["SUBMITTED", "AUTO_SUBMITTED"] },
    });
    const closingAudits = await c.auditLogs.countDocuments({
      eventType: { $in: ["EXAM_SUBMITTED", "EXAM_AUTO_SUBMITTED"] },
    });
    expect(closingAudits).toBe(closed);
  });
});

describe("expiry monitoring", () => {
  const cfg = { intervalSeconds: 15, alertAfterSeconds: 120 };
  const ok: SweepResult = {
    workerId: "w1",
    claimed: 0,
    closed: 0,
    alreadyClosed: 0,
    failed: 0,
    overdue: 0,
    oldestOverdueSeconds: 0,
    durationMs: 3,
  };

  it("is degraded until the worker has run, then ok", async () => {
    expect((await getJobHealth(db, cfg)).status).toBe("degraded");
    await recordWorkerRun(db, { result: ok, workerId: "w1", at: new Date() });
    const health = await getJobHealth(db, cfg);
    expect(health).toMatchObject({ status: "ok", problems: [] });
  });

  it("reports failed runs and delayed auto-submission", async () => {
    await recordWorkerRun(db, { result: ok, workerId: "w1", at: new Date() });
    await recordWorkerRun(db, {
      error: Object.assign(new Error("x"), { name: "MongoServerSelectionError" }),
      workerId: "w1",
      at: new Date(),
    });
    await overdueAttempts(2, 600);
    const health = await getJobHealth(db, cfg);
    expect(health.status).toBe("degraded");
    expect(health.expiryWorker.consecutiveFailures).toBe(1);
    expect(health.expiryWorker.lastError?.name).toBe("MongoServerSelectionError");
    expect(health.overdueAttempts.count).toBe(2);
    expect(health.problems.join(" ")).toMatch(/past their deadline/);
  });

  it("flags a worker that stopped running", async () => {
    await recordWorkerRun(db, { result: ok, workerId: "w1", at: new Date(Date.now() - 600_000) });
    expect((await getJobHealth(db, cfg)).problems.join(" ")).toMatch(/no successful expiry run/);
  });
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import type { ExamSessionResponse } from "@/types/api";
import type {
  ExamPaperResponse,
  ProctoringEventItem,
  ProctoringEventsResponse,
  SaveAnswerResponse,
} from "@/types/paper";
import { getCollections, type ExamDoc, type QuestionDoc, type UserDoc } from "../db/collections";
import { closeMongoClient } from "../db/mongodb";
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
  submitExam,
  submitSystemCheck,
} from "./exam-api";
import {
  getExamPaper,
  listProctoringEvents,
  recordProctoringEvent,
  saveExamAnswer,
} from "./exam-paper-api";

let db: Db;
let candidate: UserDoc;
let exam: ExamDoc;
let questions: QuestionDoc[];

type ErrorBody = { error: { code: string; message: string; details?: Record<string, unknown> } };
const body = async <T>(res: Response) => (await res.json()) as T;

const post = (path: string, who: UserDoc, payload: unknown = {}) =>
  apiRequest(path, { method: "POST", candidate: who, body: payload });

/** Walks an attempt to READY (no identity step) and optionally starts the exam. */
async function attempt({ start = true, who = candidate } = {}) {
  const s = await body<ExamSessionResponse>(
    await startExamAttempt(post(`/api/exams/${exam._id}/attempts`, who), exam._id.toHexString()),
  );
  const id = s.attempt.id;
  await submitSystemCheck(
    post(`/api/exam-attempts/${id}/system-check`, who, { results: ALL_PASSED }),
    id,
  );
  await acknowledgeInstructions(post(`/api/exam-attempts/${id}/instructions/acknowledge`, who), id);
  if (start) {
    const res = await startExam(post(`/api/exam-attempts/${id}/start-exam`, who), id);
    expect(res.status).toBe(200);
  }
  return id;
}

const paper = (id: string, who: UserDoc = candidate) =>
  getExamPaper(apiRequest(`/api/exam-attempts/${id}/paper`, { candidate: who }), id);

const save = (id: string, questionId: string, payload: unknown, who: UserDoc = candidate) =>
  saveExamAnswer(
    post(`/api/exam-attempts/${id}/answers/${questionId}`, who, payload),
    id,
    questionId,
  );

const submit = (id: string, who: UserDoc = candidate) =>
  submitExam(post(`/api/exam-attempts/${id}/submit`, who), id);

const qid = (i: number) => questions[i]._id.toHexString();

beforeEach(async () => {
  db = await resetTestDb();
  candidate = await createCandidate(db, { name: "Asha Menon", rollNumber: "RN-555" });
  exam = await createExam(db, {
    sections: [
      { id: "A", title: "Section A" },
      { id: "B", title: "Section B" },
    ],
    proctoringPolicy: {
      cameraRequired: true,
      microphoneRequired: true,
      screenMonitoringRequired: false,
      fullscreenRequired: true,
      identityVerificationRequired: false,
    },
  });
  questions = await createQuestions(db, exam, 6, ["A", "B"]);
});

afterAll(async () => {
  await (await resetTestDb()).dropDatabase();
  await closeMongoClient();
});

describe("GET /api/exam-attempts/:attemptId/paper", () => {
  it("is only available once the exam has started", async () => {
    const id = await attempt({ start: false });
    const res = await paper(id);
    expect(res.status).toBe(409);
    expect((await body<ErrorBody>(res)).error.code).toBe("INVALID_STATE");
  });

  it("returns the ordered questions and sections, and never the correct answers", async () => {
    const id = await attempt();
    const res = await paper(id);
    expect(res.status).toBe(200);
    const p = await body<ExamPaperResponse>(res);
    expect(p.questions.map((q) => q.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(p.questions.map((q) => q.id)).toEqual(questions.map((q) => q._id.toHexString()));
    expect(p.sections).toEqual([
      { id: "A", title: "Section A", questionCount: 3 },
      { id: "B", title: "Section B", questionCount: 3 },
    ]);
    expect(p.answers.every((a) => !a.visited && a.selectedOptionId === null)).toBe(true);
    const raw = JSON.stringify(p);
    expect(raw).not.toMatch(/correct/i);
    expect(raw).not.toMatch(/topic|difficulty/i);
  });

  it("doesn't reveal another candidate's attempt", async () => {
    const id = await attempt();
    const intruder = await createCandidate(db, { name: "Someone Else" });
    expect((await paper(id, intruder)).status).toBe(404);
  });
});

describe("POST /api/exam-attempts/:attemptId/answers/:questionId", () => {
  it("saves a valid answer with a server timestamp and returns the authoritative state", async () => {
    const id = await attempt();
    const before = Date.now();
    const res = await save(id, qid(0), {
      selectedOptionId: "c",
      expectedVersion: 0,
      savedAt: "2001-01-01T00:00:00Z",
      candidateId: "000000000000000000000000",
    });
    expect(res.status).toBe(200);
    const { answer } = await body<SaveAnswerResponse>(res);
    expect(answer).toMatchObject({ selectedOptionId: "c", answerVersion: 1, visited: true });
    expect(Date.parse(answer.savedAt!)).toBeGreaterThanOrEqual(before - 5);

    const stored = await getCollections(db).candidateAnswers.findOne({});
    expect(stored).toMatchObject({ selectedOptionIds: ["c"], candidateId: candidate._id });
    const p = await body<ExamPaperResponse>(await paper(id));
    expect(p.answers[0]).toMatchObject({ selectedOptionId: "c", answerVersion: 1 });
  });

  it("rejects an option that isn't part of the question", async () => {
    const id = await attempt();
    const res = await save(id, qid(0), { selectedOptionId: "z", expectedVersion: 0 });
    expect(res.status).toBe(422);
    expect(await getCollections(db).candidateAnswers.countDocuments({})).toBe(0);
  });

  it("rejects a question from another exam", async () => {
    const id = await attempt();
    const other = await createExam(db, { examCode: "OTHER-1" });
    const [foreign] = await createQuestions(db, other, 1);
    const res = await save(id, foreign._id.toHexString(), {
      selectedOptionId: "b",
      expectedVersion: 0,
    });
    expect(res.status).toBe(404);
    expect((await save(id, "not-an-id", { visited: true })).status).toBe(404);
  });

  it("doesn't let another candidate change the answer", async () => {
    const id = await attempt();
    await save(id, qid(0), { selectedOptionId: "a", expectedVersion: 0 });
    const intruder = await createCandidate(db, { name: "Someone Else" });
    const res = await save(id, qid(0), { selectedOptionId: "d", expectedVersion: 1 }, intruder);
    expect(res.status).toBe(404);
    expect((await getCollections(db).candidateAnswers.findOne({}))!.selectedOptionIds).toEqual([
      "a",
    ]);
  });

  it("reports a stale write as a conflict with the current answer", async () => {
    const id = await attempt();
    await save(id, qid(0), { selectedOptionId: "a", expectedVersion: 0 });
    const res = await save(id, qid(0), { selectedOptionId: "d", expectedVersion: 0 });
    expect(res.status).toBe(409);
    const err = await body<ErrorBody>(res);
    expect(err.error.code).toBe("ANSWER_CONFLICT");
    expect(err.error.details).toMatchObject({
      answer: { selectedOptionId: "a", answerVersion: 1 },
    });
  });

  it("treats a retried request (same requestId) as success, not a conflict", async () => {
    const id = await attempt();
    const payload = { selectedOptionId: "b", expectedVersion: 0, requestId: "req-12345678" };
    expect((await save(id, qid(0), payload)).status).toBe(200);
    const retry = await save(id, qid(0), payload);
    expect(retry.status).toBe(200);
    expect((await body<SaveAnswerResponse>(retry)).answer.answerVersion).toBe(1);
  });

  it("concurrent conflicting writes: exactly one wins and the state stays consistent", async () => {
    const id = await attempt();
    const options = ["a", "b", "c", "d", "a"];
    const results = await Promise.all(
      options.map((o) => save(id, qid(1), { selectedOptionId: o, expectedVersion: 0 })),
    );
    const ok = results.filter((r) => r.status === 200);
    expect(ok).toHaveLength(1);
    expect(results.every((r) => r.status === 200 || r.status === 409)).toBe(true);
    const winner = (await body<SaveAnswerResponse>(ok[0])).answer;
    const stored = await getCollections(db).candidateAnswers.find({}).toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0].answerVersion).toBe(1);
    expect(stored[0].selectedOptionIds).toEqual([winner.selectedOptionId]);
  });

  it("clears a saved answer only when explicitly asked", async () => {
    const id = await attempt();
    await save(id, qid(0), { selectedOptionId: "a", expectedVersion: 0 });
    const res = await save(id, qid(0), { selectedOptionId: null, expectedVersion: 1 });
    expect((await body<SaveAnswerResponse>(res)).answer).toMatchObject({
      selectedOptionId: null,
      answerVersion: 2,
    });
  });

  it("persists review and visit state without touching the answer version", async () => {
    const id = await attempt();
    await save(id, qid(2), { visited: true });
    await save(id, qid(2), { markedForReview: true });
    await save(id, qid(3), { markedForReview: true });
    const p = await body<ExamPaperResponse>(await paper(id));
    expect(p.answers[2]).toMatchObject({ visited: true, markedForReview: true, answerVersion: 0 });
    expect(p.answers[3]).toMatchObject({ visited: false, markedForReview: true });
    // Marking after answering keeps the answer.
    await save(id, qid(2), { selectedOptionId: "c", expectedVersion: 0 });
    await save(id, qid(2), { markedForReview: false });
    const after = await body<ExamPaperResponse>(await paper(id));
    expect(after.answers[2]).toMatchObject({ selectedOptionId: "c", markedForReview: false });
  });
});

describe("timeout and submission", () => {
  it("after the deadline, answers are refused and the attempt is auto-submitted once", async () => {
    const id = await attempt();
    await save(id, qid(0), { selectedOptionId: "a", expectedVersion: 0 });
    const c = getCollections(db);
    const deadline = new Date(Date.now() - 1000);
    await c.examAttempts.updateOne({}, { $set: { expiresAt: deadline } });

    const late = await save(id, qid(0), { selectedOptionId: "d", expectedVersion: 1 });
    expect(late.status).toBe(409);
    expect((await body<ErrorBody>(late)).error.code).toBe("ATTEMPT_SUBMITTED");
    expect((await save(id, qid(1), { visited: true })).status).toBe(409);

    const stored = await c.examAttempts.findOne({});
    expect(stored!.status).toBe("AUTO_SUBMITTED");
    expect(stored!.submittedAt!.getTime()).toBe(deadline.getTime());
    expect(await c.auditLogs.countDocuments({ eventType: "EXAM_AUTO_SUBMITTED" })).toBe(1);
    expect(
      (await c.candidateAnswers.findOne({ questionId: questions[0]._id }))!.selectedOptionIds,
    ).toEqual(["a"]);
    // Submitting afterwards is idempotent and reports the final state.
    const again = await submit(id);
    expect(again.status).toBe(200);
    expect((await body<ExamSessionResponse>(again)).attempt.status).toBe("AUTO_SUBMITTED");
  });

  it("expires instead of auto-submitting when the exam's policy disables auto-submit", async () => {
    exam = await createExam(db, {
      securityPolicy: { ...exam.securityPolicy, autoSubmitOnExpiry: false },
      proctoringPolicy: { ...exam.proctoringPolicy, identityVerificationRequired: false },
    });
    questions = await createQuestions(db, exam, 2);
    const id = await attempt();
    await getCollections(db).examAttempts.updateOne(
      {},
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    expect((await paper(id)).status).toBe(409);
    expect((await getCollections(db).examAttempts.findOne({}))!.status).toBe("EXPIRED");
  });

  it("submission is idempotent under concurrent requests and locks the answers", async () => {
    const id = await attempt();
    await save(id, qid(0), { selectedOptionId: "a", expectedVersion: 0 });
    const results = await Promise.all([submit(id), submit(id), submit(id)]);
    for (const r of results) {
      expect(r.status).toBe(200);
      expect((await body<ExamSessionResponse>(r)).attempt.status).toBe("SUBMITTED");
    }
    const c = getCollections(db);
    expect(await c.auditLogs.countDocuments({ eventType: "EXAM_SUBMITTED" })).toBe(1);
    const audit = await c.auditLogs.findOne({ eventType: "EXAM_SUBMITTED" });
    expect(audit!.metadata).toMatchObject({ answeredCount: 1 });
    const late = await save(id, qid(1), { selectedOptionId: "b", expectedVersion: 0 });
    expect((await body<ErrorBody>(late)).error.code).toBe("ATTEMPT_SUBMITTED");
  });

  it("a submission racing with answer writes never accepts an answer after it", async () => {
    const id = await attempt();
    const writes = questions.map((q) =>
      save(id, q._id.toHexString(), { selectedOptionId: "a", expectedVersion: 0 }),
    );
    const [submitted, ...saved] = await Promise.all([submit(id), ...writes]);
    expect(submitted.status).toBe(200);
    const c = getCollections(db);
    const attemptDoc = await c.examAttempts.findOne({});
    const accepted = saved.filter((r) => r.status === 200).length;
    const answers = await c.candidateAnswers.find({}).toArray();
    expect(answers).toHaveLength(accepted);
    for (const a of answers) {
      expect(a.savedAt!.getTime()).toBeLessThanOrEqual(attemptDoc!.submittedAt!.getTime());
    }
  });

  it("can't submit before the exam has started", async () => {
    const id = await attempt({ start: false });
    expect((await submit(id)).status).toBe(409);
  });
});

describe("proctoring events", () => {
  const record = (id: string, payload: unknown, who: UserDoc = candidate) =>
    recordProctoringEvent(post(`/api/exam-attempts/${id}/proctoring-events`, who, payload), id);
  const list = (id: string, query = "", who: UserDoc = candidate) =>
    listProctoringEvents(
      apiRequest(`/api/exam-attempts/${id}/proctoring-events${query}`, { candidate: who }),
      id,
    );

  it("records only known events, with server-decided label, severity and time", async () => {
    const id = await attempt();
    expect((await record(id, { type: "HEAD_TURNED" })).status).toBe(422);
    const before = Date.now();
    const res = await record(id, {
      type: "CAMERA_DISCONNECTED",
      severity: "INFO",
      occurredAt: "2001-01-01T00:00:00Z",
      label: "nothing happened",
    });
    expect(res.status).toBe(201);
    const { event } = await body<{ event: ProctoringEventItem }>(res);
    expect(event).toMatchObject({
      type: "CAMERA_DISCONNECTED",
      label: "Camera disconnected",
      severity: "HIGH",
      source: "BROWSER",
    });
    expect(Date.parse(event.occurredAt)).toBeGreaterThanOrEqual(before - 5);
    const c = getCollections(db);
    expect(await c.proctoringEvents.countDocuments({})).toBe(1);
    expect(await c.auditLogs.countDocuments({ eventType: "PROCTORING_EVENT_RECORDED" })).toBe(1);
  });

  it("lists the attempt's own events, newest first, with a limit", async () => {
    const id = await attempt();
    for (const type of ["FULLSCREEN_EXITED", "TAB_HIDDEN", "CAMERA_DISCONNECTED"]) {
      await record(id, { type });
      await new Promise((r) => setTimeout(r, 5));
    }
    const res = await body<ProctoringEventsResponse>(await list(id, "?limit=2"));
    expect(res.total).toBe(3);
    expect(res.events.map((e) => e.type)).toEqual(["CAMERA_DISCONNECTED", "TAB_HIDDEN"]);
    const intruder = await createCandidate(db, { name: "Someone Else" });
    expect((await list(id, "", intruder)).status).toBe(404);
    expect((await record(id, { type: "TAB_HIDDEN" }, intruder)).status).toBe(404);
  });

  it("isn't accepted before the exam starts", async () => {
    const id = await attempt({ start: false });
    expect((await record(id, { type: "TAB_HIDDEN" })).status).toBe(409);
  });
});

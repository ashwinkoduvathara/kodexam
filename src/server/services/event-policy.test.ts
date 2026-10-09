import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { ExamSessionResponse } from "@/types/api";
import {
  DEFAULT_EVENT_POLICY,
  evaluateEvent,
  type EventPolicyConfig,
} from "@/types/proctoring-policy";
import type { RecordEventResponse } from "@/types/paper";
import { getCollections, type ExamDoc, type UserDoc } from "../db/collections";
import { closeMongoClient } from "../db/mongodb";
import {
  acknowledgeInstructions,
  startExam,
  startExamAttempt,
  submitSystemCheck,
} from "../api/exam-api";
import { recordProctoringEvent } from "../api/exam-paper-api";
import { ALL_PASSED, apiRequest, createCandidate, createExam, resetTestDb } from "../test/fixtures";
import { createExamPaperService } from "./exam-paper-service";

let db: Db;
let candidate: UserDoc;
const ctx = { ipAddress: null, userAgent: "vitest" };

const post = (path: string, body: unknown = {}) =>
  apiRequest(path, { method: "POST", candidate, body });

async function runningAttempt(eventPolicy?: EventPolicyConfig) {
  const exam: ExamDoc = await createExam(db, {
    proctoringPolicy: {
      cameraRequired: true,
      microphoneRequired: true,
      screenMonitoringRequired: false,
      fullscreenRequired: true,
      identityVerificationRequired: false,
      ...(eventPolicy ? { eventPolicy } : {}),
    },
  });
  const s = (await (
    await startExamAttempt(post(`/api/exams/${exam._id}/attempts`), exam._id.toHexString())
  ).json()) as ExamSessionResponse;
  const id = s.attempt.id;
  await submitSystemCheck(
    post(`/api/exam-attempts/${id}/system-check`, { results: ALL_PASSED }),
    id,
  );
  await acknowledgeInstructions(post(`/api/exam-attempts/${id}/instructions/acknowledge`), id);
  await startExam(post(`/api/exam-attempts/${id}/start-exam`), id);
  return id;
}

const report = async (id: string, type: string) =>
  (await (
    await recordProctoringEvent(post(`/api/exam-attempts/${id}/proctoring-events`, { type }), id)
  ).json()) as RecordEventResponse;

beforeEach(async () => {
  db = await resetTestDb();
  candidate = await createCandidate(db);
});

afterAll(async () => {
  await (await resetTestDb()).dropDatabase();
  await closeMongoClient();
});

describe("evaluateEvent (pure policy)", () => {
  const strict: EventPolicyConfig = {
    rules: { CAMERA_DISCONNECTED: { warnAt: 1, reviewAt: 2, terminateAt: 3 } },
    allowAutomaticTermination: true,
  };

  it("escalates record → warn → review by occurrence count", () => {
    const at = (count: number) =>
      evaluateEvent({ type: "TAB_HIDDEN", source: "BROWSER", count, policy: DEFAULT_EVENT_POLICY })
        .action;
    expect([at(1), at(2), at(3), at(9)]).toEqual(["WARN", "WARN", "REVIEW", "REVIEW"]);
    expect(
      evaluateEvent({
        type: "CAMERA_RESTORED",
        source: "BROWSER",
        count: 5,
        policy: DEFAULT_EVENT_POLICY,
      }).action,
    ).toBe("RECORD");
  });

  it("never terminates on an untrusted (browser) signal — it recommends human review", () => {
    const d = evaluateEvent({
      type: "CAMERA_DISCONNECTED",
      source: "BROWSER",
      count: 3,
      policy: strict,
    });
    expect(d).toMatchObject({ action: "REVIEW", terminationRecommended: true });
  });

  it("terminates only for a trusted source when the policy explicitly allows it", () => {
    const trusted = {
      type: "CAMERA_DISCONNECTED" as const,
      source: "DETECTION_SERVICE" as const,
      count: 3,
    };
    expect(evaluateEvent({ ...trusted, policy: strict }).action).toBe("TERMINATE");
    expect(
      evaluateEvent({ ...trusted, policy: { ...strict, allowAutomaticTermination: false } }),
    ).toMatchObject({ action: "REVIEW", terminationRecommended: true });
  });
});

describe("event policy enforcement on the server", () => {
  it("warns neutrally, then flags for review once, and the attempt keeps running", async () => {
    const id = await runningAttempt();
    const first = await report(id, "TAB_HIDDEN");
    expect(first.notice).toMatch(/keep the exam window open/i);
    expect(first.notice).not.toMatch(/cheat|violation|malpractice|flag/i);
    await report(id, "TAB_HIDDEN");
    const third = await report(id, "TAB_HIDDEN");
    expect(third.examEnded).toBe(false);
    expect(JSON.stringify(third)).not.toMatch(/review|flag/i);
    await report(id, "TAB_HIDDEN");

    const c = getCollections(db);
    const attempt = await c.examAttempts.findOne({ _id: new ObjectId(id) });
    expect(attempt!.status).toBe("IN_PROGRESS");
    expect(attempt!.review).toMatchObject({ required: true, reasons: ["TAB_HIDDEN"] });
    expect(await c.auditLogs.countDocuments({ eventType: "CANDIDATE_WARNED" })).toBe(2);
    expect(await c.auditLogs.countDocuments({ eventType: "ATTEMPT_FLAGGED_FOR_REVIEW" })).toBe(1);
    const events = await c.proctoringEvents.find({}).sort({ occurredAt: 1 }).toArray();
    expect(events.map((e) => e.enforcement?.action)).toEqual(["WARN", "WARN", "REVIEW", "REVIEW"]);
  });

  it("browser reports can't end the exam even under a termination rule", async () => {
    const id = await runningAttempt({
      rules: { FULLSCREEN_EXITED: { terminateAt: 1 } },
      allowAutomaticTermination: true,
    });
    const r = await report(id, "FULLSCREEN_EXITED");
    expect(r.examEnded).toBe(false);
    const attempt = await getCollections(db).examAttempts.findOne({ _id: new ObjectId(id) });
    expect(attempt!.status).toBe("IN_PROGRESS");
    expect(attempt!.review?.reasons).toEqual(["FULLSCREEN_EXITED:TERMINATION_RECOMMENDED"]);
  });

  it("a trusted detection source can end the exam when the policy allows it (audited)", async () => {
    const id = await runningAttempt({
      rules: { CAMERA_DISCONNECTED: { terminateAt: 2 } },
      allowAutomaticTermination: true,
    });
    const c = getCollections(db);
    const attempt = (await c.examAttempts.findOne({ _id: new ObjectId(id) }))!;
    const svc = createExamPaperService(db);
    expect((await svc.recordTrustedEvent(attempt, "CAMERA_DISCONNECTED", ctx)).examEnded).toBe(
      false,
    );
    expect((await svc.recordTrustedEvent(attempt, "CAMERA_DISCONNECTED", ctx)).examEnded).toBe(
      true,
    );
    const ended = await c.examAttempts.findOne({ _id: attempt._id });
    expect(ended).toMatchObject({ status: "SUBMITTED", closedReason: "POLICY_TERMINATION" });
    expect(await c.auditLogs.countDocuments({ eventType: "EXAM_TERMINATED_BY_POLICY" })).toBe(1);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExamSessionResponse } from "@/types/api";
import { DEFAULT_EXAM_INSTRUCTIONS } from "@/types/exam";
import {
  createHttpExamSessionService,
  ExamApiError,
  toExamSession,
} from "./http-exam-session-service";

const dto: ExamSessionResponse = {
  exam: {
    id: "e1",
    code: "DS-7319",
    name: "Distributed Systems",
    description: "",
    durationMinutes: 75,
    totalQuestions: 42,
    totalMarks: 120,
    passingMarks: 48,
    attemptLimit: 2,
    instructions: DEFAULT_EXAM_INSTRUCTIONS,
  },
  candidate: { id: "c1", name: "Asha Menon", rollNumber: "RN-555", avatarUrl: null },
  attempt: {
    id: "a1",
    attemptNumber: 1,
    status: "INSTRUCTIONS",
    startedAt: "2026-10-08T10:00:00.000Z",
    examStartedAt: null,
    expiresAt: "2026-10-08T11:15:00.000Z",
    systemCheckCompletedAt: "2026-10-08T10:02:00.000Z",
    instructionsAcknowledgedAt: null,
    identityVerificationStatus: "PENDING",
    identityVerificationCompletedAt: null,
  },
  proctoringPolicy: {
    cameraRequired: true,
    microphoneRequired: true,
    screenMonitoringRequired: true,
    fullscreenRequired: true,
    identityVerificationRequired: true,
  },
  securityPolicy: {
    allowTabSwitch: false,
    allowExternalDevices: false,
    allowBackNavigation: false,
    allowPause: false,
    autoSubmitOnExpiry: true,
  },
  requiredChecks: ["camera", "microphone", "speaker", "network"],
  serverTime: "2026-10-08T10:05:00.000Z",
};

const respond = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

afterEach(() => vi.unstubAllGlobals());

describe("toExamSession", () => {
  it("uses the server's expiresAt as the only deadline", () => {
    const s = toExamSession(dto);
    expect(s.examEndTime).toBe(dto.attempt.expiresAt);
    expect(s.examDurationSeconds).toBe(75 * 60);
    expect(s).toMatchObject({ examName: "Distributed Systems", rollNumber: "RN-555" });
  });
});

describe("HttpExamSessionService", () => {
  it("openSession starts the first attempt when the server reports NO_ATTEMPT", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() =>
        respond(404, { error: { code: "NO_ATTEMPT", message: "No attempt" } }),
      )
      .mockImplementationOnce(() => respond(201, dto));
    vi.stubGlobal("fetch", fetchMock);

    const session = await createHttpExamSessionService().openSession("e1");
    expect(session.attemptId).toBe("a1");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/exams/e1/session");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/exams/e1/attempts");
    expect(fetchMock.mock.calls[1][1].method).toBe("POST");
  });

  it("calls the acknowledge endpoint and surfaces typed errors", async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      respond(409, { error: { code: "ATTEMPT_EXPIRED", message: "Exam session has expired." } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const error = await createHttpExamSessionService()
      .acknowledgeInstructions("a1")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExamApiError);
    expect((error as ExamApiError).code).toBe("ATTEMPT_EXPIRED");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/exam-attempts/a1/instructions/acknowledge");
  });

  it("reports network failures without leaking raw errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    const error = (await createHttpExamSessionService()
      .getSession("e1")
      .catch((e: unknown) => e)) as ExamApiError;
    expect(error.code).toBe("SERVICE_UNAVAILABLE");
    expect(error.message).not.toContain("Failed to fetch");
  });
});

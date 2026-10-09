import {
  API_ERROR,
  type EndAttemptResponse,
  type ExamAttemptResponse,
  type ExamSessionResponse,
  type SystemCheckRequest,
} from "@/types/api";
import { apiRequest, ExamApiError, NETWORK_MESSAGE } from "../api-client";
import type { ExamSession } from "../types";
import type { ExamSessionService } from "./exam-session-service";

export { ExamApiError } from "../api-client";

/** Maps the API's wire format to the UI's view model. */
export function toExamSession(dto: ExamSessionResponse): ExamSession {
  return {
    examId: dto.exam.id,
    attemptId: dto.attempt.id,
    candidateId: dto.candidate.id,
    candidateName: dto.candidate.name,
    rollNumber: dto.candidate.rollNumber,
    candidateAvatarUrl: dto.candidate.avatarUrl ?? undefined,
    examCode: dto.exam.code,
    examName: dto.exam.name,
    examDescription: dto.exam.description,
    examDurationSeconds: dto.exam.durationMinutes * 60,
    examEndTime: dto.attempt.expiresAt,
    examStartedAt: dto.attempt.examStartedAt,
    autoSubmit: dto.securityPolicy.autoSubmitOnExpiry,
    requiredChecks: dto.requiredChecks,
    attemptNumber: dto.attempt.attemptNumber,
    attemptLimit: dto.exam.attemptLimit,
    attemptStatus: dto.attempt.status,
    totalQuestions: dto.exam.totalQuestions,
    totalMarks: dto.exam.totalMarks,
    passingMarks: dto.exam.passingMarks,
    instructions: dto.exam.instructions,
    proctoringPolicy: dto.proctoringPolicy,
    securityPolicy: dto.securityPolicy,
    systemCheckCompletedAt: dto.attempt.systemCheckCompletedAt,
    instructionsAcknowledgedAt: dto.attempt.instructionsAcknowledgedAt,
    identityVerificationStatus: dto.attempt.identityVerificationStatus,
    identityVerificationCompletedAt: dto.attempt.identityVerificationCompletedAt,
  };
}

function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  return apiRequest<T>(method, path, body === undefined ? {} : { json: body });
}

const enc = encodeURIComponent;

export function createHttpExamSessionService(): ExamSessionService {
  const svc: ExamSessionService = {
    async getSession(examId) {
      return toExamSession(
        await request<ExamSessionResponse>("GET", `/api/exams/${enc(examId)}/session`),
      );
    },

    async startAttempt(examId) {
      return toExamSession(
        await request<ExamSessionResponse>("POST", `/api/exams/${enc(examId)}/attempts`, {}),
      );
    },

    async openSession(examId) {
      try {
        return await svc.getSession(examId);
      } catch (error) {
        if (error instanceof ExamApiError && error.code === API_ERROR.NO_ATTEMPT) {
          return svc.startAttempt(examId);
        }
        throw error;
      }
    },

    getAttempt(attemptId) {
      return request<ExamAttemptResponse>("GET", `/api/exam-attempts/${enc(attemptId)}`);
    },

    async submitSystemCheck(attemptId, summary) {
      const body: SystemCheckRequest = { results: summary.results };
      return toExamSession(
        await request<ExamSessionResponse>(
          "POST",
          `/api/exam-attempts/${enc(attemptId)}/system-check`,
          body,
        ),
      );
    },

    async acknowledgeInstructions(attemptId) {
      return toExamSession(
        await request<ExamSessionResponse>(
          "POST",
          `/api/exam-attempts/${enc(attemptId)}/instructions/acknowledge`,
          {},
        ),
      );
    },

    async startExam(attemptId) {
      return toExamSession(
        await request<ExamSessionResponse>(
          "POST",
          `/api/exam-attempts/${enc(attemptId)}/start-exam`,
          {},
        ),
      );
    },

    async submitExam(attemptId) {
      try {
        const session = await request<ExamSessionResponse>(
          "POST",
          `/api/exam-attempts/${enc(attemptId)}/submit`,
          {},
        );
        return { ok: true, session: toExamSession(session) };
      } catch (error) {
        if (error instanceof ExamApiError) {
          return { ok: false, code: error.code, message: error.message };
        }
        return { ok: false, code: API_ERROR.INTERNAL, message: NETWORK_MESSAGE };
      }
    },

    async endExamAttempt(attemptId) {
      try {
        const res = await request<EndAttemptResponse>(
          "POST",
          `/api/exam-attempts/${enc(attemptId)}/end`,
          {},
        );
        return { ok: true, session: toExamSession(res.session) };
      } catch (error) {
        if (error instanceof ExamApiError) {
          return { ok: false, code: error.code, message: error.message };
        }
        return { ok: false, code: API_ERROR.INTERNAL, message: NETWORK_MESSAGE };
      }
    },
  };
  return svc;
}

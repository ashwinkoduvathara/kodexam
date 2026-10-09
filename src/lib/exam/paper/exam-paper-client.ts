import type {
  AnswerState,
  ExamPaperResponse,
  ProctoringEventsResponse,
  RecordEventResponse,
  ProctoringEventType,
  SaveAnswerRequest,
  SaveAnswerResponse,
} from "@/types/paper";
import { apiRequest } from "../api-client";

/**
 * Boundary between the running-exam UI and the API. Components never call
 * fetch directly; every response here is the server's authoritative state.
 */
export interface ExamPaperClient {
  getPaper(attemptId: string): Promise<ExamPaperResponse>;
  saveAnswer(attemptId: string, questionId: string, req: SaveAnswerRequest): Promise<AnswerState>;
  recordEvent(attemptId: string, type: ProctoringEventType): Promise<RecordEventResponse>;
  listEvents(attemptId: string, limit?: number): Promise<ProctoringEventsResponse>;
}

const enc = encodeURIComponent;

export function createHttpExamPaperClient(): ExamPaperClient {
  return {
    getPaper: (attemptId) =>
      apiRequest<ExamPaperResponse>("GET", `/api/exam-attempts/${enc(attemptId)}/paper`),

    async saveAnswer(attemptId, questionId, req) {
      const res = await apiRequest<SaveAnswerResponse>(
        "POST",
        `/api/exam-attempts/${enc(attemptId)}/answers/${enc(questionId)}`,
        { json: req },
      );
      return res.answer;
    },

    recordEvent: (attemptId, type) =>
      apiRequest<RecordEventResponse>(
        "POST",
        `/api/exam-attempts/${enc(attemptId)}/proctoring-events`,
        { json: { type } },
      ),

    listEvents: (attemptId, limit = 20) =>
      apiRequest<ProctoringEventsResponse>(
        "GET",
        `/api/exam-attempts/${enc(attemptId)}/proctoring-events?limit=${limit}`,
      ),
  };
}

let client: ExamPaperClient | null = null;
export function getExamPaperClient(): ExamPaperClient {
  return (client ??= createHttpExamPaperClient());
}

import type { ExamAttemptResponse } from "@/types/api";
import type { ExamSession, SystemCheckId, SystemCheckStatus } from "../types";
import { createHttpExamSessionService } from "./http-exam-session-service";

export interface SystemCheckSummary {
  completedAt: string;
  results: Partial<Record<SystemCheckId, SystemCheckStatus>>;
  latencyMs?: number | null;
}

export type EndAttemptResult =
  { ok: true; session: ExamSession } | { ok: false; code: string; message: string };

/**
 * Boundary between the exam UI and the KProctor backend.
 * Components and routes only talk to this interface — never to the API or DB directly.
 */
export interface ExamSessionService {
  /** Latest attempt for this exam; starts the first attempt if none exists yet. */
  openSession(examId: string): Promise<ExamSession>;
  getSession(examId: string): Promise<ExamSession>;
  startAttempt(examId: string): Promise<ExamSession>;
  getAttempt(attemptId: string): Promise<ExamAttemptResponse>;
  /** Records that the candidate passed the pre-exam checks. No media is ever sent. */
  submitSystemCheck(attemptId: string, summary: SystemCheckSummary): Promise<ExamSession>;
  acknowledgeInstructions(attemptId: string): Promise<ExamSession>;
  /** READY → IN_PROGRESS. The exam timer starts on the server at this moment. */
  startExam(attemptId: string): Promise<ExamSession>;
  /** Submits a running exam (End Exam). Idempotent; resolves only with the server's result. */
  submitExam(attemptId: string): Promise<EndAttemptResult>;
  endExamAttempt(attemptId: string): Promise<EndAttemptResult>;
}

let service: ExamSessionService | null = null;

export function getExamSessionService(): ExamSessionService {
  service ??= createHttpExamSessionService();
  return service;
}

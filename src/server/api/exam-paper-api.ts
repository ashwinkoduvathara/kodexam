import "@tanstack/react-start/server-only";
import type { SaveAnswerResponse } from "@/types/paper";
import { authenticateCandidate } from "../auth/candidate-auth";
import { getDb } from "../db/mongodb";
import { assertSameOrigin, auditContext, handleApi, json, readJson } from "../http/api";
import { createExamPaperService } from "../services/exam-paper-service";

/**
 * Running-exam REST handlers: question paper, answers and proctoring events.
 * Each authenticates first; the service enforces ownership, IN_PROGRESS and the deadline.
 */

interface HandlerOptions {
  ipAddress?: string | null;
}

async function service() {
  return createExamPaperService(await getDb());
}

export function getExamPaper(request: Request, attemptId: string, opts: HandlerOptions = {}) {
  return handleApi(async () => {
    const candidateId = authenticateCandidate(request);
    const paper = await (
      await service()
    ).getPaper(attemptId, candidateId, auditContext(request, opts.ipAddress));
    return json(paper);
  });
}

export function saveExamAnswer(
  request: Request,
  attemptId: string,
  questionId: string,
  opts: HandlerOptions = {},
) {
  return handleApi(async () => {
    assertSameOrigin(request);
    const candidateId = authenticateCandidate(request);
    const body = await readJson<unknown>(request);
    const answer = await (
      await service()
    ).saveAnswer(attemptId, questionId, candidateId, body, auditContext(request, opts.ipAddress));
    const res: SaveAnswerResponse = { answer };
    return json(res);
  });
}

export function recordProctoringEvent(
  request: Request,
  attemptId: string,
  opts: HandlerOptions = {},
) {
  return handleApi(async () => {
    assertSameOrigin(request);
    const candidateId = authenticateCandidate(request);
    const body = await readJson<unknown>(request);
    const result = await (
      await service()
    ).recordEvent(attemptId, candidateId, body, auditContext(request, opts.ipAddress));
    return json(result, 201);
  });
}

export function listProctoringEvents(
  request: Request,
  attemptId: string,
  opts: HandlerOptions = {},
) {
  return handleApi(async () => {
    const candidateId = authenticateCandidate(request);
    const limit = new URL(request.url).searchParams.get("limit");
    const events = await (
      await service()
    ).listEvents(attemptId, candidateId, limit, auditContext(request, opts.ipAddress));
    return json(events);
  });
}

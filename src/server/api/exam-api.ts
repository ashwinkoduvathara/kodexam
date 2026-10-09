import "@tanstack/react-start/server-only";
import type { EndAttemptResponse, SystemCheckRequest } from "@/types/api";
import { authenticateCandidate, authenticateSession } from "../auth/candidate-auth";
import { getDb } from "../db/mongodb";
import { assertSameOrigin, auditContext, handleApi, json, readJson } from "../http/api";
import { createExamSessionService } from "../services/exam-session-service";

/**
 * REST handlers. Route files under src/routes/api only forward to these, which
 * keeps them testable with plain `Request` objects.
 *
 * Every handler authenticates first; ownership is enforced in the service.
 */

interface HandlerOptions {
  ipAddress?: string | null;
}

async function service() {
  return createExamSessionService(await getDb());
}

export function getExamSession(request: Request, examId: string, opts: HandlerOptions = {}) {
  return handleApi(async () => {
    const { candidateId, examScope } = authenticateSession(request);
    const session = await (
      await service()
    ).getSession(examId, candidateId, auditContext(request, opts.ipAddress), examScope);
    return json(session);
  });
}

export function startExamAttempt(request: Request, examId: string, opts: HandlerOptions = {}) {
  return handleApi(async () => {
    assertSameOrigin(request);
    const { candidateId, examScope } = authenticateSession(request);
    const session = await (
      await service()
    ).startAttempt(examId, candidateId, auditContext(request, opts.ipAddress), examScope);
    return json(session, 201);
  });
}

export function getExamAttempt(request: Request, attemptId: string, opts: HandlerOptions = {}) {
  return handleApi(async () => {
    const candidateId = authenticateCandidate(request);
    const attempt = await (
      await service()
    ).getAttempt(attemptId, candidateId, auditContext(request, opts.ipAddress));
    return json(attempt);
  });
}

export function submitSystemCheck(request: Request, attemptId: string, opts: HandlerOptions = {}) {
  return handleApi(async () => {
    assertSameOrigin(request);
    const candidateId = authenticateCandidate(request);
    const body = await readJson<Partial<SystemCheckRequest>>(request);
    const results = body.results && typeof body.results === "object" ? body.results : {};
    const session = await (
      await service()
    ).completeSystemCheck(attemptId, candidateId, results, auditContext(request, opts.ipAddress));
    return json(session);
  });
}

export function acknowledgeInstructions(
  request: Request,
  attemptId: string,
  opts: HandlerOptions = {},
) {
  return handleApi(async () => {
    assertSameOrigin(request);
    const candidateId = authenticateCandidate(request);
    const session = await (
      await service()
    ).acknowledgeInstructions(attemptId, candidateId, auditContext(request, opts.ipAddress));
    return json(session);
  });
}

export function startExam(request: Request, attemptId: string, opts: HandlerOptions = {}) {
  return handleApi(async () => {
    assertSameOrigin(request);
    const candidateId = authenticateCandidate(request);
    const session = await (
      await service()
    ).startExam(attemptId, candidateId, auditContext(request, opts.ipAddress));
    return json(session);
  });
}

export function submitExam(request: Request, attemptId: string, opts: HandlerOptions = {}) {
  return handleApi(async () => {
    assertSameOrigin(request);
    const candidateId = authenticateCandidate(request);
    const session = await (
      await service()
    ).submitExam(attemptId, candidateId, auditContext(request, opts.ipAddress));
    return json(session);
  });
}

export function endExamAttempt(request: Request, attemptId: string, opts: HandlerOptions = {}) {
  return handleApi(async () => {
    assertSameOrigin(request);
    const candidateId = authenticateCandidate(request);
    const session = await (
      await service()
    ).endAttempt(attemptId, candidateId, auditContext(request, opts.ipAddress));
    const body: EndAttemptResponse = { ended: true, session };
    return json(body);
  });
}

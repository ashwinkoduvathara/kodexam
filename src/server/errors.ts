import "@tanstack/react-start/server-only";
import { API_ERROR, type ApiErrorCode } from "@/types/api";

/** Expected, candidate-safe failure. Its message is returned to the client verbatim. */
export class DomainError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly status: number,
    message: string,
    /** Candidate-safe data returned with the error (e.g. the current answer on a conflict). */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const unauthenticated = () =>
  new DomainError(
    API_ERROR.UNAUTHENTICATED,
    401,
    "Your exam session couldn't be verified. Open the exam again from your Kodeversity dashboard.",
  );

export const attemptNotFound = () =>
  new DomainError(API_ERROR.NOT_FOUND, 404, "This exam attempt could not be found.");

export const attemptExpired = () =>
  new DomainError(API_ERROR.ATTEMPT_EXPIRED, 409, "Exam session has expired.");

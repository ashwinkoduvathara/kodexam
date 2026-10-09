import { ATTEMPT_STATUS, IDENTITY_STATUS } from "@/types/exam-attempt";
import type { ExamSession } from "./types";

export interface StartEligibility {
  /** The UI may offer Start Exam. The server re-validates everything independently. */
  canStart: boolean;
  /** Eligible only because this exam's policy allows starting while identity is under review. */
  identityUnderReview: boolean;
  /** Why the candidate can't start yet; null when they can. */
  reason: string | null;
}

type EligibilityInput = Pick<
  ExamSession,
  | "attemptStatus"
  | "systemCheckCompletedAt"
  | "instructionsAcknowledgedAt"
  | "identityVerificationStatus"
  | "proctoringPolicy"
>;

const blocked = (reason: string): StartEligibility => ({
  canStart: false,
  identityUnderReview: false,
  reason,
});

/**
 * Mirrors the server's start-exam checks so the page never offers a start the
 * server would refuse. It is a presentation aid only, never authorisation.
 */
export function getStartEligibility(session: EligibilityInput, expired: boolean): StartEligibility {
  if (expired) return blocked("Exam session has expired.");
  if (session.attemptStatus === ATTEMPT_STATUS.IN_PROGRESS) {
    return blocked("This exam has already started.");
  }
  if (session.attemptStatus !== ATTEMPT_STATUS.READY) {
    return blocked("Complete the previous steps before starting the exam.");
  }
  if (!session.systemCheckCompletedAt) return blocked("Complete the system check before starting.");
  if (!session.instructionsAcknowledgedAt) {
    return blocked("Acknowledge the exam instructions before starting.");
  }

  const identity = session.identityVerificationStatus;
  const policy = session.proctoringPolicy;
  if (
    identity === IDENTITY_STATUS.VERIFIED ||
    (identity === IDENTITY_STATUS.NOT_REQUIRED && !policy.identityVerificationRequired)
  ) {
    return { canStart: true, identityUnderReview: false, reason: null };
  }
  if (
    identity === IDENTITY_STATUS.REVIEW_REQUIRED &&
    policy.identityReviewPolicy === "ALLOW_PENDING_REVIEW"
  ) {
    return { canStart: true, identityUnderReview: true, reason: null };
  }
  if (identity === IDENTITY_STATUS.FAILED) {
    return blocked("Your identity verification was not successful. Please contact support.");
  }
  return blocked("Your identity verification must be completed before starting.");
}

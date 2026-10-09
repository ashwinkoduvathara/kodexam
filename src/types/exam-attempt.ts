/**
 * Exam attempt lifecycle, shared by server and client.
 */

export const ATTEMPT_STATUS = {
  NOT_STARTED: "NOT_STARTED",
  SYSTEM_CHECK: "SYSTEM_CHECK",
  INSTRUCTIONS: "INSTRUCTIONS",
  IDENTITY_VERIFICATION: "IDENTITY_VERIFICATION",
  READY: "READY",
  IN_PROGRESS: "IN_PROGRESS",
  SUBMITTED: "SUBMITTED",
  AUTO_SUBMITTED: "AUTO_SUBMITTED",
  EXPIRED: "EXPIRED",
  CANCELLED: "CANCELLED",
} as const;
export type AttemptStatus = (typeof ATTEMPT_STATUS)[keyof typeof ATTEMPT_STATUS];

/** Before the candidate starts answering questions. */
export const PRE_EXAM_STATUSES: readonly AttemptStatus[] = [
  ATTEMPT_STATUS.NOT_STARTED,
  ATTEMPT_STATUS.SYSTEM_CHECK,
  ATTEMPT_STATUS.INSTRUCTIONS,
  ATTEMPT_STATUS.IDENTITY_VERIFICATION,
  ATTEMPT_STATUS.READY,
];

/** The attempt is still open (pre-exam or answering). */
export const ACTIVE_ATTEMPT_STATUSES: readonly AttemptStatus[] = [
  ...PRE_EXAM_STATUSES,
  ATTEMPT_STATUS.IN_PROGRESS,
];

/** The attempt is closed; nothing more can change. */
export const TERMINAL_ATTEMPT_STATUSES: readonly AttemptStatus[] = [
  ATTEMPT_STATUS.SUBMITTED,
  ATTEMPT_STATUS.AUTO_SUBMITTED,
  ATTEMPT_STATUS.EXPIRED,
  ATTEMPT_STATUS.CANCELLED,
];

export function isTerminalStatus(status: AttemptStatus): boolean {
  return TERMINAL_ATTEMPT_STATUSES.includes(status);
}

/** Result of one pre-exam device check as recorded on the attempt. */
export const CHECK_RESULT = {
  PASSED: "passed",
  WARNING: "warning",
  FAILED: "failed",
  NOT_AVAILABLE: "not_available",
  NOT_RUN: "not_run",
} as const;
export type CheckResult = (typeof CHECK_RESULT)[keyof typeof CHECK_RESULT];

export const SYSTEM_CHECK_IDS = ["camera", "microphone", "speaker", "network"] as const;
export type SystemCheckKey = (typeof SYSTEM_CHECK_IDS)[number];

export interface AttemptSystemCheck {
  camera: CheckResult;
  microphone: CheckResult;
  speaker: CheckResult;
  network: CheckResult;
  completedAt: string | null;
}

export const IDENTITY_STATUS = {
  PENDING: "PENDING",
  VERIFIED: "VERIFIED",
  FAILED: "FAILED",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
  NOT_REQUIRED: "NOT_REQUIRED",
} as const;
export type IdentityStatus = (typeof IDENTITY_STATUS)[keyof typeof IDENTITY_STATUS];

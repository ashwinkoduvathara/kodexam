/**
 * Shared domain types for the KProctor exam flow.
 */
import type { ExamInstruction, ProctoringPolicy, SecurityPolicy } from "@/types/exam";
import type { AttemptStatus, IdentityStatus } from "@/types/exam-attempt";

/**
 * Lifecycle of a single pre-exam system check.
 *
 * - idle:          waiting on the candidate (e.g. speaker test not played yet)
 * - checking:      test in progress
 * - passed:        requirement met
 * - warning:       requirement met, with a non-blocking advisory (e.g. slower connection)
 * - failed:        blocked — permission problem, device error, no input, connection lost…
 * - not_available: hardware or browser capability is missing
 */
export type SystemCheckStatus =
  "idle" | "checking" | "passed" | "warning" | "failed" | "not_available";

export type SystemCheckId = "camera" | "microphone" | "speaker" | "network";

export const ALL_SYSTEM_CHECKS: SystemCheckId[] = ["camera", "microphone", "speaker", "network"];

/** Machine-readable cause of a non-passing state. */
export type CheckReason =
  | "permission_required"
  | "permission_prompt"
  | "no_device"
  | "no_input"
  | "device_error"
  | "disconnected"
  | "timeout"
  | "unsupported"
  | "not_heard"
  | "retest_needed"
  | "connection_lost"
  | "slow_connection"
  | "server_unreachable";

export interface CheckMessage {
  title: string;
  description: string;
}

export interface CheckState {
  status: SystemCheckStatus;
  reason?: CheckReason;
  /** Short badge text; falls back to a per-status default when omitted. */
  label?: string;
  /** Candidate-facing explanation of a non-passing state. Never a raw browser error. */
  message?: CheckMessage;
}

/** A check is satisfied when the candidate may proceed past it. */
export function isCheckSatisfied(status: SystemCheckStatus): boolean {
  return status === "passed" || status === "warning";
}

export function isCheckBlocked(state: CheckState): boolean {
  return state.status === "failed" || state.status === "not_available";
}

export type SystemCheckStates = Record<SystemCheckId, CheckState>;

/** Result of a live readiness probe — inspects the real stream/context, not React state. */
export type ProbeResult = { ok: true } | { ok: false; reason: string };
export type ReadinessProbe = () => ProbeResult | Promise<ProbeResult>;

export type ExamStepId = "system-check" | "instructions" | "identity" | "start";

export interface ExamStep {
  id: ExamStepId;
  title: string;
  description: string;
}

/**
 * Everything the exam shell and System Check need about the current attempt.
 * Provided by an `ExamSessionService` (see ./session).
 */
export interface ExamSession {
  examId: string;
  attemptId: string;
  candidateId: string;
  candidateName: string;
  rollNumber: string;
  candidateAvatarUrl?: string;
  examCode: string;
  examName: string;
  /** Total exam duration in seconds (display only — never used to derive the deadline). */
  examDurationSeconds: number;
  /**
   * Server-issued deadline, ISO-8601. The only source of truth for the countdown.
   * Before the exam starts this is the exam window's end, not a running exam timer.
   */
  examEndTime: string;
  /** When the exam itself started (the timer began); null during the pre-exam steps. */
  examStartedAt: string | null;
  autoSubmit: boolean;
  requiredChecks: SystemCheckId[];

  // ── Attempt & exam details (from GET /api/exams/:examId/session) ──
  attemptNumber: number;
  attemptLimit: number;
  attemptStatus: AttemptStatus;
  examDescription: string;
  totalQuestions: number;
  totalMarks: number;
  passingMarks: number;
  instructions: ExamInstruction[];
  proctoringPolicy: ProctoringPolicy;
  securityPolicy: SecurityPolicy;
  systemCheckCompletedAt: string | null;
  instructionsAcknowledgedAt: string | null;
  identityVerificationStatus: IdentityStatus;
  identityVerificationCompletedAt: string | null;
}

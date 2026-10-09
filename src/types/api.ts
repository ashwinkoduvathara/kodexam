/**
 * Wire format of the KProctor REST API. Shared by server handlers and the
 * client ExamSessionService. Dates are ISO-8601 strings.
 */
import type { ExamInstruction, ProctoringPolicy, SecurityPolicy } from "./exam";
import type {
  AttemptStatus,
  AttemptSystemCheck,
  IdentityStatus,
  SystemCheckKey,
} from "./exam-attempt";

export interface ExamSessionResponse {
  exam: {
    id: string;
    code: string;
    name: string;
    description: string;
    durationMinutes: number;
    totalQuestions: number;
    totalMarks: number;
    passingMarks: number;
    attemptLimit: number;
    instructions: ExamInstruction[];
  };
  candidate: {
    id: string;
    name: string;
    rollNumber: string;
    avatarUrl: string | null;
  };
  attempt: {
    id: string;
    attemptNumber: number;
    status: AttemptStatus;
    /** When the attempt (pre-exam setup) was opened. */
    startedAt: string;
    /** When the exam itself started and its timer began; null during setup. */
    examStartedAt: string | null;
    /**
     * Authoritative deadline. Before the exam starts it is the exam window's end;
     * once started it is min(examStartedAt + duration, window end).
     */
    expiresAt: string;
    systemCheckCompletedAt: string | null;
    instructionsAcknowledgedAt: string | null;
    identityVerificationStatus: IdentityStatus;
    identityVerificationCompletedAt: string | null;
  };
  proctoringPolicy: ProctoringPolicy;
  securityPolicy: SecurityPolicy;
  requiredChecks: SystemCheckKey[];
  serverTime: string;
}

export interface ExamAttemptResponse {
  id: string;
  examId: string;
  attemptNumber: number;
  status: AttemptStatus;
  startedAt: string;
  examStartedAt: string | null;
  expiresAt: string;
  submittedAt: string | null;
  systemCheck: AttemptSystemCheck;
  instructionsAcknowledgedAt: string | null;
  identityVerification: { status: IdentityStatus; completedAt: string | null };
}

export interface SystemCheckRequest {
  results: Partial<Record<SystemCheckKey, string>>;
}

export interface EndAttemptResponse {
  ended: true;
  session: ExamSessionResponse;
}

export const API_ERROR = {
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  NO_ATTEMPT: "NO_ATTEMPT",
  EXAM_NOT_ACTIVE: "EXAM_NOT_ACTIVE",
  ATTEMPT_LIMIT_REACHED: "ATTEMPT_LIMIT_REACHED",
  ATTEMPT_EXPIRED: "ATTEMPT_EXPIRED",
  INVALID_STATE: "INVALID_STATE",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  UNSUPPORTED_DOCUMENT: "UNSUPPORTED_DOCUMENT",
  DOCUMENT_REJECTED: "DOCUMENT_REJECTED",
  INSECURE_TRANSPORT: "INSECURE_TRANSPORT",
  /** The answer changed since the client last read it (another tab or a racing request). */
  ANSWER_CONFLICT: "ANSWER_CONFLICT",
  /** The exam has been submitted or timed out; answers are locked. */
  ATTEMPT_SUBMITTED: "ATTEMPT_SUBMITTED",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  INTERNAL: "INTERNAL",
} as const;
export type ApiErrorCode = (typeof API_ERROR)[keyof typeof API_ERROR];

export interface ApiErrorBody {
  /** `details` carries candidate-safe state for recovery (e.g. the current answer on a conflict). */
  error: { code: ApiErrorCode; message: string; details?: Record<string, unknown> };
}

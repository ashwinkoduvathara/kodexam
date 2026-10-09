import "@tanstack/react-start/server-only";
import type { Collection, Db, ObjectId } from "mongodb";
import type { EnforcementAction, EventSource } from "@/types/proctoring-policy";
import type {
  ExamSection,
  ProctoringEventType,
  ProctoringSeverity,
  QuestionType,
} from "@/types/paper";
import type { ExamInstruction, ExamStatus, ProctoringPolicy, SecurityPolicy } from "@/types/exam";
import type {
  DocumentFileType,
  IdDocumentType,
  IdentityVerificationStatus,
  ScanStatus,
} from "@/types/identity";
import type {
  AttemptStatus,
  CheckResult,
  IdentityStatus,
  SystemCheckKey,
} from "@/types/exam-attempt";

export const COLLECTIONS = {
  users: "users",
  exams: "exams",
  examAttempts: "examAttempts",
  questions: "questions",
  examSessions: "examSessions",
  proctoringEvents: "proctoringEvents",
  identityVerifications: "identityVerifications",
  candidateAnswers: "candidateAnswers",
  supportTickets: "supportTickets",
  auditLogs: "auditLogs",
} as const;

// ─── Documents ───────────────────────────────────────────────────────────────

export const USER_ROLE = { CANDIDATE: "candidate", ADMIN: "admin", PROCTOR: "proctor" } as const;
export type UserRole = (typeof USER_ROLE)[keyof typeof USER_ROLE];

export interface UserDoc {
  _id: ObjectId;
  role: UserRole;
  name: string;
  email: string | null;
  rollNumber: string | null;
  avatarUrl: string | null;
  /** The user's id in the Kodeversity LMS (`sub` of LMS launch tokens). */
  lmsUserId?: string | null;
  status: "ACTIVE" | "DISABLED";
  createdAt: Date;
  updatedAt: Date;
}

export interface ExamDoc {
  _id: ObjectId;
  examCode: string;
  name: string;
  description: string;
  durationMinutes: number;
  totalQuestions: number;
  totalMarks: number;
  passingMarks: number;
  attemptLimit: number;
  status: ExamStatus;
  instructions: ExamInstruction[];
  proctoringPolicy: ProctoringPolicy;
  securityPolicy: SecurityPolicy;
  /** Optional sections; questions reference them by `sectionId`. */
  sections?: ExamSection[];
  /** Exam window. Attempts can only start inside it and never run past `endAt`. */
  startAt: Date;
  endAt: Date;
  createdBy: ObjectId | null;
  /** Examiners (proctor users) allowed to review this exam's identity verifications. */
  examinerIds?: ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ExamAttemptDoc {
  _id: ObjectId;
  examId: ObjectId;
  candidateId: ObjectId;
  attemptNumber: number;
  status: AttemptStatus;
  /** When the attempt was opened (pre-exam setup began). The exam timer does NOT start here. */
  startedAt: Date;
  /** When the candidate started the exam itself (READY → IN_PROGRESS). Null before that. */
  examStartedAt?: Date | null;
  /** Last answer write; also the write fence that serialises answers against submission. */
  lastAnswerAt?: Date;
  /** Why a closed attempt ended. */
  closedReason?: "CANDIDATE" | "TIME_LIMIT" | "POLICY_TERMINATION";
  /** Expiry worker claim: which worker is closing this attempt, until when. */
  expiryLease?: { by: string; until: Date };
  /** Set when proctoring events need a human reviewer (never an accusation by itself). */
  review?: {
    required: boolean;
    reasons: string[];
    flaggedAt: Date;
  };
  /**
   * Server-issued deadline.
   * - Pre-exam (setup screens): exam.endAt — setup is bounded only by the exam window.
   * - From examStartedAt: min(examStartedAt + duration, exam.endAt).
   */
  expiresAt: Date;
  submittedAt: Date | null;
  cancelledAt: Date | null;
  systemCheck: {
    camera: CheckResult;
    microphone: CheckResult;
    speaker: CheckResult;
    network: CheckResult;
    completedAt: Date | null;
  };
  instructionsAcknowledgedAt: Date | null;
  identityVerification: { status: IdentityStatus; completedAt: Date | null };
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Server-side snapshot of what governs an attempt, frozen when it starts so
 * later edits to the exam's policy can't change an attempt already in progress.
 */
export interface ExamSessionDoc {
  _id: ObjectId;
  attemptId: ObjectId;
  examId: ObjectId;
  candidateId: ObjectId;
  examEndTime: Date;
  requiredChecks: SystemCheckKey[];
  proctoringPolicy: ProctoringPolicy;
  securityPolicy: SecurityPolicy;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuestionDoc {
  _id: ObjectId;
  examId: ObjectId;
  /** Server-defined position; the candidate's question numbers follow it. */
  order: number;
  sectionId?: string | null;
  type: QuestionType;
  prompt: string;
  options: { id: string; text: string }[];
  /** SERVER ONLY. Never projected into any candidate response. */
  correctOptionIds: string[];
  marks: number;
  topic?: string;
  difficulty?: "EASY" | "MEDIUM" | "HARD";
  createdAt: Date;
  updatedAt: Date;
}

/** One document per (attempt, question): the candidate's persisted answer and review state. */
export interface CandidateAnswerDoc {
  _id: ObjectId;
  attemptId: ObjectId;
  examId: ObjectId;
  candidateId: ObjectId;
  questionId: ObjectId;
  /** Single-choice answers hold at most one id. */
  selectedOptionIds: string[];
  markedForReview: boolean;
  /** Absent until first viewed (so `$min` can set it once). */
  visitedAt?: Date;
  /** Optimistic concurrency for answer changes. */
  answerVersion: number;
  /** Last answer-changing request, so a retried request isn't reported as a conflict. */
  lastRequestId: string | null;
  savedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProctoringEventDoc {
  _id: ObjectId;
  attemptId: ObjectId;
  examId: ObjectId;
  candidateId: ObjectId;
  type: ProctoringEventType;
  severity: ProctoringSeverity;
  /** Server time the event was recorded (never a browser timestamp). */
  occurredAt: Date;
  source: EventSource;
  /** What the server's event policy decided for this occurrence. */
  enforcement?: { action: EnforcementAction; terminationRecommended: boolean; count: number };
  metadata: Record<string, unknown>;
  createdAt: Date;
}

/**
 * One identity verification per attempt. Holds metadata and opaque storage
 * references only — never document bytes, images or a government ID number.
 * `version` provides optimistic concurrency for reviewer decisions.
 */
export interface IdentityVerificationDoc {
  _id: ObjectId;
  attemptId: ObjectId;
  candidateId: ObjectId;
  examId: ObjectId;
  status: IdentityVerificationStatus;
  version: number;
  verificationMethod: string;
  capturedAt: Date | null;
  verifiedAt: Date | null;
  photo: {
    reference: string;
    sha256: string;
    sizeBytes: number;
    width: number;
    height: number;
    storageProvider: string;
    capturedAt: Date;
    expiresAt: Date;
  } | null;
  idDocument: {
    documentType: IdDocumentType;
    documentReference: string;
    documentHash: string;
    fileType: DocumentFileType;
    sizeBytes: number;
    storageProvider: string;
    scanStatus: ScanStatus;
    scannedAt: Date | null;
    uploadedAt: Date;
    expiresAt: Date;
  } | null;
  candidateSnapshot: { name: string; rollNumber: string };
  verificationResult: {
    faceMatch: boolean | null;
    documentValid: boolean | null;
    documentReadable: boolean | null;
    verificationScore: number | null;
    reviewRequired: boolean;
    provider: string;
    reason: string | null;
  } | null;
  reviewer: {
    reviewerId: ObjectId;
    reviewedAt: Date;
    decision: "APPROVE" | "REJECT";
  } | null;
  consentAt: Date | null;
  processingStartedAt: Date | null;
  retryCount: number;
  lastError: { code: string; at: Date } | null;
  /** Earliest retention deadline of any stored object (drives the purge job). */
  dataExpiresAt: Date | null;
  purgedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SupportTicketDoc {
  _id: ObjectId;
  candidateId: ObjectId;
  attemptId: ObjectId | null;
  subject: string;
  message: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED";
  createdAt: Date;
  updatedAt: Date;
}

export const AUDIT_EVENT = {
  ATTEMPT_STARTED: "ATTEMPT_STARTED",
  ATTEMPT_EXPIRED: "ATTEMPT_EXPIRED",
  ATTEMPT_CANCELLED: "ATTEMPT_CANCELLED",
  EXAM_STARTED: "EXAM_STARTED",
  EXAM_SUBMITTED: "EXAM_SUBMITTED",
  EXAM_AUTO_SUBMITTED: "EXAM_AUTO_SUBMITTED",
  PROCTORING_EVENT_RECORDED: "PROCTORING_EVENT_RECORDED",
  CANDIDATE_WARNED: "CANDIDATE_WARNED",
  ATTEMPT_FLAGGED_FOR_REVIEW: "ATTEMPT_FLAGGED_FOR_REVIEW",
  EXAM_TERMINATED_BY_POLICY: "EXAM_TERMINATED_BY_POLICY",
  CANDIDATE_LAUNCHED: "CANDIDATE_LAUNCHED",
  LAUNCH_REJECTED: "LAUNCH_REJECTED",
  SYSTEM_CHECK_COMPLETED: "SYSTEM_CHECK_COMPLETED",
  INSTRUCTIONS_ACKNOWLEDGED: "INSTRUCTIONS_ACKNOWLEDGED",
  IDENTITY_VERIFICATION_STARTED: "IDENTITY_VERIFICATION_STARTED",
  CAMERA_CAPTURED: "CAMERA_CAPTURED",
  DOCUMENT_UPLOADED: "DOCUMENT_UPLOADED",
  DOCUMENT_REJECTED: "DOCUMENT_REJECTED",
  DOCUMENT_SCAN_COMPLETED: "DOCUMENT_SCAN_COMPLETED",
  DOCUMENT_DELETED: "DOCUMENT_DELETED",
  DOCUMENT_VIEWED: "DOCUMENT_VIEWED",
  PHOTO_VIEWED: "PHOTO_VIEWED",
  IDENTITY_VERIFICATION_PROCESSING: "IDENTITY_VERIFICATION_PROCESSING",
  IDENTITY_VERIFIED: "IDENTITY_VERIFIED",
  IDENTITY_FAILED: "IDENTITY_FAILED",
  IDENTITY_REVIEW_REQUIRED: "IDENTITY_REVIEW_REQUIRED",
  IDENTITY_VERIFICATION_RETRY: "IDENTITY_VERIFICATION_RETRY",
  IDENTITY_VERIFICATION_EXPIRED: "IDENTITY_VERIFICATION_EXPIRED",
  IDENTITY_DATA_PURGED: "IDENTITY_DATA_PURGED",
} as const;
export type AuditEvent = (typeof AUDIT_EVENT)[keyof typeof AUDIT_EVENT];

export type AuditActorType = "CANDIDATE" | "REVIEWER" | "SYSTEM";

/**
 * Audit record. `_id` (ObjectId) is the unique event ID and gives a stable
 * tie-break when timestamps are equal. Metadata must never contain document
 * contents, images, ID numbers, tokens or URLs.
 */
export interface AuditLogDoc {
  _id: ObjectId;
  eventType: AuditEvent;
  timestamp: Date;
  actorType: AuditActorType;
  actorId: ObjectId | null;
  attemptId: ObjectId | null;
  examId: ObjectId | null;
  candidateId: ObjectId | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
}

// ─── Typed accessors ─────────────────────────────────────────────────────────

export interface Collections {
  users: Collection<UserDoc>;
  exams: Collection<ExamDoc>;
  examAttempts: Collection<ExamAttemptDoc>;
  questions: Collection<QuestionDoc>;
  examSessions: Collection<ExamSessionDoc>;
  proctoringEvents: Collection<ProctoringEventDoc>;
  identityVerifications: Collection<IdentityVerificationDoc>;
  candidateAnswers: Collection<CandidateAnswerDoc>;
  supportTickets: Collection<SupportTicketDoc>;
  auditLogs: Collection<AuditLogDoc>;
}

export function getCollections(db: Db): Collections {
  return {
    users: db.collection<UserDoc>(COLLECTIONS.users),
    exams: db.collection<ExamDoc>(COLLECTIONS.exams),
    examAttempts: db.collection<ExamAttemptDoc>(COLLECTIONS.examAttempts),
    questions: db.collection<QuestionDoc>(COLLECTIONS.questions),
    examSessions: db.collection<ExamSessionDoc>(COLLECTIONS.examSessions),
    proctoringEvents: db.collection<ProctoringEventDoc>(COLLECTIONS.proctoringEvents),
    identityVerifications: db.collection<IdentityVerificationDoc>(
      COLLECTIONS.identityVerifications,
    ),
    candidateAnswers: db.collection<CandidateAnswerDoc>(COLLECTIONS.candidateAnswers),
    supportTickets: db.collection<SupportTicketDoc>(COLLECTIONS.supportTickets),
    auditLogs: db.collection<AuditLogDoc>(COLLECTIONS.auditLogs),
  };
}

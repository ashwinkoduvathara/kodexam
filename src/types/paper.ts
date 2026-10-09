/**
 * Wire format for the running exam: the question paper, answer state and
 * proctoring events. Shared by the server handlers and the browser client.
 *
 * The paper never contains correct answers.
 */
import type { EventSource } from "./proctoring-policy";

/** Question types the exam screen can render and the server can grade input for. */
export const SUPPORTED_QUESTION_TYPES = ["SINGLE_CHOICE"] as const;
export type QuestionType = "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "SHORT_ANSWER";

export interface ExamSection {
  id: string;
  title: string;
}

export interface PaperQuestion {
  id: string;
  /** 1-based position in the server-defined order. */
  number: number;
  sectionId: string | null;
  type: QuestionType;
  prompt: string;
  options: { id: string; text: string }[];
  marks: number;
}

/** Authoritative, persisted state of one question for this attempt. */
export interface AnswerState {
  questionId: string;
  selectedOptionId: string | null;
  markedForReview: boolean;
  visited: boolean;
  /** Increments on every answer change; required to change the answer (optimistic concurrency). */
  answerVersion: number;
  savedAt: string | null;
}

export interface ExamPaperResponse {
  sections: (ExamSection & { questionCount: number })[];
  questions: PaperQuestion[];
  answers: AnswerState[];
  serverTime: string;
}

/**
 * POST /api/exam-attempts/:attemptId/answers/:questionId
 * Every field is optional; send only what changes.
 */
export interface SaveAnswerRequest {
  /** New answer, or null to clear the saved answer. Requires `expectedVersion`. */
  selectedOptionId?: string | null;
  expectedVersion?: number;
  /** Client-generated id so a retried request isn't treated as a conflict. */
  requestId?: string;
  markedForReview?: boolean;
  visited?: true;
}

export interface SaveAnswerResponse {
  answer: AnswerState;
}

// ─── Proctoring events ──────────────────────────────────────────────────────

export type ProctoringSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH";

/**
 * Events the exam page can actually observe in the browser. Labels and
 * severities are set by the server from this table, never by the request.
 * Wording is neutral: an event is a fact to review, not an accusation.
 */
export const PROCTORING_EVENTS = {
  CAMERA_DISCONNECTED: {
    label: "Camera disconnected",
    description: "The camera stopped sending video.",
    severity: "HIGH",
  },
  CAMERA_RESTORED: {
    label: "Camera reconnected",
    description: "The camera is sending video again.",
    severity: "INFO",
  },
  MICROPHONE_DISCONNECTED: {
    label: "Microphone disconnected",
    description: "The microphone stopped working.",
    severity: "MEDIUM",
  },
  MICROPHONE_RESTORED: {
    label: "Microphone reconnected",
    description: "The microphone is working again.",
    severity: "INFO",
  },
  FULLSCREEN_EXITED: {
    label: "Fullscreen exited",
    description: "The exam left fullscreen mode.",
    severity: "MEDIUM",
  },
  FULLSCREEN_RESTORED: {
    label: "Fullscreen restored",
    description: "The exam returned to fullscreen mode.",
    severity: "INFO",
  },
  TAB_HIDDEN: {
    label: "Exam window hidden",
    description: "The exam tab was hidden or another window was brought to the front.",
    severity: "MEDIUM",
  },
} as const satisfies Record<
  string,
  { label: string; description: string; severity: ProctoringSeverity }
>;
export type ProctoringEventType = keyof typeof PROCTORING_EVENTS;

export const isProctoringEventType = (value: unknown): value is ProctoringEventType =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(PROCTORING_EVENTS, value);

export interface ProctoringEventItem {
  id: string;
  type: ProctoringEventType;
  label: string;
  description: string;
  severity: ProctoringSeverity;
  /** Server time the event was recorded. */
  occurredAt: string;
  /** Where the observation came from (the browser is an untrusted source). */
  source: EventSource;
}

/** POST proctoring-events response. Never says "flagged" or anything accusatory. */
export interface RecordEventResponse {
  event: ProctoringEventItem;
  /** Neutral instruction to show the candidate, when the policy asks for one. */
  notice: string | null;
  /** The policy ended the exam (only ever for trusted sources). */
  examEnded: boolean;
}

export interface ProctoringEventsResponse {
  events: ProctoringEventItem[];
  total: number;
}

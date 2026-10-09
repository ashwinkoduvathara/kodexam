import type { EventPolicyConfig } from "./proctoring-policy";

/**
 * Exam domain types shared by the server (MongoDB documents) and the client
 * (API responses). Must not import server-only code.
 */

export const EXAM_STATUS = {
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  ARCHIVED: "ARCHIVED",
} as const;
export type ExamStatus = (typeof EXAM_STATUS)[keyof typeof EXAM_STATUS];

export interface ProctoringPolicy {
  cameraRequired: boolean;
  microphoneRequired: boolean;
  screenMonitoringRequired: boolean;
  fullscreenRequired: boolean;
  identityVerificationRequired: boolean;
  /**
   * What happens when identity verification needs manual review.
   * BLOCK (default): the candidate waits for a reviewer's decision.
   * ALLOW_PENDING_REVIEW: the candidate may start; the review completes later.
   */
  identityReviewPolicy?: "BLOCK" | "ALLOW_PENDING_REVIEW";
  /** How proctoring events are enforced; DEFAULT_EVENT_POLICY when absent. */
  eventPolicy?: EventPolicyConfig;
}

export interface SecurityPolicy {
  allowTabSwitch: boolean;
  allowExternalDevices: boolean;
  allowBackNavigation: boolean;
  allowPause: boolean;
  /** Answers are submitted automatically when the attempt expires. */
  autoSubmitOnExpiry: boolean;
}

/** Icons an exam author may attach to an instruction. Mapped to lucide icons in the UI. */
export const INSTRUCTION_ICONS = [
  "monitor",
  "camera",
  "user",
  "book",
  "smartphone",
  "shield",
  "clock",
  "info",
] as const;
export type InstructionIcon = (typeof INSTRUCTION_ICONS)[number];

export interface ExamInstruction {
  id: string;
  title: string;
  description: string;
  icon: InstructionIcon;
}

/**
 * KProctor's standard candidate instructions, used when an exam doesn't define
 * its own. Exam-specific instructions are stored on the exam document.
 */
export const DEFAULT_EXAM_INSTRUCTIONS: ExamInstruction[] = [
  {
    id: "stay-in-environment",
    title: "Stay in the Exam Environment",
    description:
      "Do not switch browser tabs, windows or applications while the examination is in progress.",
    icon: "monitor",
  },
  {
    id: "camera-on",
    title: "Keep Your Camera On",
    description: "Your camera must remain enabled throughout the examination.",
    icon: "camera",
  },
  {
    id: "remain-visible",
    title: "Remain Visible",
    description:
      "Keep your face clearly visible to the camera and remain seated in front of your device.",
    icon: "user",
  },
  {
    id: "allowed-resources",
    title: "Use Only Allowed Resources",
    description:
      "Only resources explicitly permitted by the examination administrator may be used.",
    icon: "book",
  },
  {
    id: "external-devices",
    title: "Avoid External Devices",
    description:
      "Do not use mobile phones, smartwatches, headphones or other unauthorized devices unless specifically permitted.",
    icon: "smartphone",
  },
  {
    id: "integrity",
    title: "Maintain Exam Integrity",
    description:
      "Do not communicate with other people or receive assistance during the examination.",
    icon: "shield",
  },
];

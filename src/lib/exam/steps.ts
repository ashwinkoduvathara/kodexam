import { ATTEMPT_STATUS, type AttemptStatus } from "@/types/exam-attempt";
import type { ExamStep, ExamStepId } from "./types";

export const EXAM_STEPS: ExamStep[] = [
  { id: "system-check", title: "System Check", description: "Browser & device check" },
  { id: "instructions", title: "Exam Instructions", description: "Read important guidelines" },
  { id: "identity", title: "Identity Verification", description: "Webcam verification" },
  { id: "start", title: "Start Exam", description: "Begin your exam" },
];

export const STEP_ROUTES = {
  "system-check": "/exam/$examId/system-check",
  instructions: "/exam/$examId/instructions",
  identity: "/exam/$examId/identity-verification",
  start: "/exam/$examId/start",
  /** The running exam (not a preparation step). */
  active: "/exam/$examId/active",
} as const;
export type StepRoute = (typeof STEP_ROUTES)[keyof typeof STEP_ROUTES];

/** The step a candidate belongs on, according to the server's attempt status. */
export function stepForStatus(status: AttemptStatus): keyof typeof STEP_ROUTES {
  switch (status) {
    case ATTEMPT_STATUS.INSTRUCTIONS:
      return "instructions";
    case ATTEMPT_STATUS.IDENTITY_VERIFICATION:
      return "identity";
    case ATTEMPT_STATUS.READY:
      return "start";
    case ATTEMPT_STATUS.IN_PROGRESS:
      return "active";
    default:
      return "system-check";
  }
}

export function routeForStatus(status: AttemptStatus): StepRoute {
  return STEP_ROUTES[stepForStatus(status)];
}

/** Steps the server has recorded as complete — survives refreshes. */
export function completedStepsFrom(session: {
  systemCheckCompletedAt: string | null;
  instructionsAcknowledgedAt: string | null;
  attemptStatus?: AttemptStatus;
}): ExamStepId[] {
  const done: ExamStepId[] = [];
  if (session.systemCheckCompletedAt) done.push("system-check");
  if (session.instructionsAcknowledgedAt) done.push("instructions");
  // The server only moves an attempt to READY once identity verification allows it.
  if (
    session.attemptStatus === ATTEMPT_STATUS.READY ||
    session.attemptStatus === ATTEMPT_STATUS.IN_PROGRESS
  ) {
    done.push("identity");
  }
  if (session.attemptStatus === ATTEMPT_STATUS.IN_PROGRESS) done.push("start");
  return done;
}

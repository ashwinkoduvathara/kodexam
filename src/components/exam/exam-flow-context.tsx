import { createContext, useContext } from "react";
import type { ExamSession, ExamStepId } from "@/lib/exam/types";

export interface ExamFlowContextValue {
  /** Latest server-confirmed session. */
  session: ExamSession;
  /** True once the server-issued end time has passed. */
  expired: boolean;
  /** Lets a step screen tell the shell (stepper) that its requirements are met. */
  setStepReady: (step: ExamStepId, ready: boolean) => void;
  /** Replaces the session with an authoritative server response (e.g. after a mutation). */
  applySession: (session: ExamSession) => void;
  /** Re-fetches the session from the server. */
  refreshSession: () => Promise<void>;
}

export const ExamFlowContext = createContext<ExamFlowContextValue | null>(null);

export function useExamFlow(): ExamFlowContextValue {
  const ctx = useContext(ExamFlowContext);
  if (!ctx) throw new Error("useExamFlow must be used inside the exam layout route");
  return ctx;
}

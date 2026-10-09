import type { ExamStepId } from "@/lib/exam/types";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** Which step of the exam flow this route represents (drives the stepper). */
    examStep?: ExamStepId;
  }
}

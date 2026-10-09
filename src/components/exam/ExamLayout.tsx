import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { EndAttemptResult } from "@/lib/exam/session/exam-session-service";
import { EXAM_STEPS } from "@/lib/exam/steps";
import type { ExamSession, ExamStepId } from "@/lib/exam/types";
import { DesktopOnlyGate } from "./DesktopOnlyGate";
import { ExamHeader } from "./ExamHeader";
import { ExamStepper } from "./ExamStepper";
import { SupportCard } from "./SupportCard";

interface ExamLayoutProps {
  session: ExamSession;
  remainingSeconds: number | null;
  currentStep: ExamStepId;
  currentStepReady?: boolean;
  completedSteps?: ExamStepId[];
  onEndExam: () => Promise<EndAttemptResult>;
  onExamEnded: () => void;
  /** "exam": the running exam — full width, no progress sidebar. */
  variant?: "steps" | "exam";
  children: ReactNode;
}

/** KProctor shell: exam header + progress sidebar + step content. */
export function ExamLayout({
  session,
  remainingSeconds,
  currentStep,
  currentStepReady,
  completedSteps,
  onEndExam,
  onExamEnded,
  variant = "steps",
  children,
}: ExamLayoutProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <div className="kp min-h-screen bg-surface font-sans text-navy">
        <a
          href="#main-content"
          className="sr-only z-50 rounded-xl bg-navy px-4 py-2 text-sm font-bold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          {variant === "exam" ? "Skip to question" : "Skip to system check"}
        </a>
        <DesktopOnlyGate>
          <ExamHeader
            session={session}
            remainingSeconds={remainingSeconds}
            onEndExam={onEndExam}
            onExamEnded={onExamEnded}
            variant={variant}
          />
          {variant === "exam" ? (
            <main id="main-content" tabIndex={-1} className="min-w-0 outline-none">
              {children}
            </main>
          ) : (
            <div className="flex flex-1">
              <aside
                aria-label="Exam progress and help"
                className="sticky top-16 flex h-[calc(100vh-64px)] w-64 shrink-0 flex-col justify-between gap-6 overflow-y-auto border-r border-slate-200/70 bg-white px-4 py-6"
              >
                <ExamStepper
                  steps={EXAM_STEPS}
                  currentStep={currentStep}
                  currentStepReady={currentStepReady}
                  completedSteps={completedSteps}
                />
                <SupportCard session={session} />
              </aside>
              <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 outline-none">
                {children}
              </main>
            </div>
          )}
        </DesktopOnlyGate>
      </div>
    </TooltipProvider>
  );
}

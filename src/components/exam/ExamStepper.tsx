import { Check, CheckCircle2, ChevronRight } from "lucide-react";
import type { ExamStep, ExamStepId } from "@/lib/exam/types";
import { cn } from "@/lib/utils";

type StepState = "complete" | "current" | "upcoming";

interface ExamStepperProps {
  steps: ExamStep[];
  currentStep: ExamStepId;
  /** True once the current step's requirements are met (e.g. all system checks pass). */
  currentStepReady?: boolean;
  /** Steps confirmed complete by the server, shown with a check even while current. */
  completedSteps?: ExamStepId[];
}

export function ExamStepper({
  steps,
  currentStep,
  currentStepReady = false,
  completedSteps = [],
}: ExamStepperProps) {
  const currentIndex = Math.max(
    0,
    steps.findIndex((s) => s.id === currentStep),
  );

  return (
    <nav aria-label="Exam progress">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
          Exam Progress
        </h2>
        <span className="text-[10px] font-bold text-slate-500">
          Step {currentIndex + 1} of {steps.length}
        </span>
      </div>

      <ol className="mt-3 space-y-3">
        {steps.map((step, i) => {
          const isCurrent = i === currentIndex;
          const done = i < currentIndex || completedSteps.includes(step.id);
          const state: StepState = isCurrent ? "current" : done ? "complete" : "upcoming";
          const isLast = i === steps.length - 1;

          return (
            <li key={step.id} className="relative">
              {!isLast && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute -bottom-3 left-[28px] h-3 w-px",
                    i < currentIndex ? "bg-brand/50" : "bg-slate-200",
                  )}
                />
              )}
              <div
                aria-current={state === "current" ? "step" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-xl border px-3 py-3 transition-colors",
                  state === "current"
                    ? "border-brand/20 bg-brand-soft"
                    : "border-slate-200/70 bg-white",
                )}
              >
                <StepMarker index={i} state={done ? "complete" : state} />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-[13px] font-bold leading-tight",
                      state === "upcoming" ? "text-slate-600" : "text-navy",
                    )}
                  >
                    {step.title}
                  </p>
                  <p
                    className={cn(
                      "mt-0.5 text-[11px] leading-tight",
                      state === "current" ? "text-slate-600" : "text-slate-500",
                    )}
                  >
                    {step.description}
                  </p>
                </div>
                {state === "current" &&
                  (currentStepReady ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-brand" aria-label="Ready" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                  ))}
                <span className="sr-only">
                  {done ? "(completed)" : state === "upcoming" ? "(upcoming)" : "(current step)"}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StepMarker({ index, state }: { index: number; state: StepState }) {
  if (state === "complete") {
    return (
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand text-white">
        <Check className="h-4 w-4" strokeWidth={3} aria-hidden />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold",
        state === "current"
          ? "bg-brand text-white shadow-[0_0_0_4px] shadow-brand/15"
          : "border border-slate-200 bg-slate-50 text-slate-500",
      )}
    >
      {index + 1}
    </span>
  );
}

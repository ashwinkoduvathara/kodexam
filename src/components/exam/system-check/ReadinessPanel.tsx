import { useState } from "react";
import { ArrowRight, CheckCircle2, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReadinessResult } from "@/lib/exam/readiness";
import type { SystemCheckId, SystemCheckStates, SystemCheckStatus } from "@/lib/exam/types";
import { isCheckBlocked, isCheckSatisfied } from "@/lib/exam/types";
import { cn } from "@/lib/utils";
import { CHECK_LABEL, statusLabel } from "./status";

const SEGMENT_TONE: Record<SystemCheckStatus, string> = {
  idle: "bg-slate-200",
  checking: "bg-slate-200",
  passed: "bg-brand",
  warning: "bg-amber-400",
  failed: "bg-red-400",
  not_available: "bg-amber-400",
};

interface ReadinessPanelProps {
  requiredChecks: SystemCheckId[];
  states: SystemCheckStates;
  allRequiredChecksPassed: boolean;
  canContinue: boolean;
  validation: ReadinessResult | null;
  completed: boolean;
  onContinue: () => Promise<void>;
}

export function ReadinessPanel({
  requiredChecks,
  states,
  allRequiredChecksPassed,
  canContinue,
  validation,
  completed,
  onContinue,
}: ReadinessPanelProps) {
  const [submitting, setSubmitting] = useState(false);
  const passedCount = requiredChecks.filter((id) => isCheckSatisfied(states[id].status)).length;
  const needsAction = requiredChecks.filter(
    (id) => isCheckBlocked(states[id]) || states[id].status === "idle",
  );
  const inProgress = requiredChecks.some((id) => states[id].status === "checking");

  let helper: string;
  if (completed) helper = "System check complete.";
  else if (canContinue) helper = "Your device is ready for the exam.";
  else if (allRequiredChecksPassed && validation && !validation.ok)
    helper = validation.failures[0]?.reason ?? "Re-checking your devices…";
  else if (allRequiredChecksPassed) helper = "Verifying your devices…";
  else if (needsAction.length)
    helper = `Action needed: ${needsAction.map((id) => CHECK_LABEL[id]).join(", ")}.`;
  else if (inProgress) helper = "Checks are still running…";
  else helper = "Complete all checks to continue.";

  const handleClick = async () => {
    setSubmitting(true);
    try {
      await onContinue();
    } finally {
      setSubmitting(false);
    }
  };

  const enabled = canContinue && !submitting && !completed;

  return (
    <section
      aria-labelledby="readiness-heading"
      className="flex w-[320px] shrink-0 flex-col gap-3 rounded-2xl short:gap-2 short:p-3.5 border border-slate-200/70 bg-white p-4 shadow-sm"
    >
      <div className="flex items-center justify-between">
        <h2 id="readiness-heading" className="text-[13px] font-bold text-navy">
          {passedCount} of {requiredChecks.length} checks passed
        </h2>
        {canContinue && (
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-bold text-brand-strong">
            <CheckCircle2 className="h-3 w-3" aria-hidden />
            Ready
          </span>
        )}
      </div>
      <ul className="flex gap-1" aria-label="Check results">
        {requiredChecks.map((id) => (
          <li
            key={id}
            title={`${CHECK_LABEL[id]}: ${statusLabel(states[id])}`}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors",
              SEGMENT_TONE[states[id].status],
            )}
          >
            <span className="sr-only">
              {CHECK_LABEL[id]}: {statusLabel(states[id])}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] leading-snug text-slate-600" aria-live="polite">
        {helper}
      </p>
      <Button
        onClick={() => void handleClick()}
        disabled={!enabled}
        aria-describedby="readiness-heading"
        className={cn(
          "mt-auto h-11 w-full rounded-xl text-sm font-bold short:h-10",
          enabled
            ? "shadow-[0_8px_20px_-10px] shadow-brand/60"
            : "disabled:bg-slate-100 disabled:text-slate-500 disabled:opacity-100 disabled:shadow-none",
        )}
      >
        {submitting ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : completed ? (
          <CheckCircle2 aria-hidden />
        ) : (
          !canContinue && <Lock aria-hidden />
        )}
        {completed ? "System Check Complete" : "All Good, Continue"}
        {enabled && <ArrowRight aria-hidden />}
      </Button>
    </section>
  );
}

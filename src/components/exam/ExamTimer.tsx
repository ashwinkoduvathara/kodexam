import { Clock, TimerOff } from "lucide-react";
import {
  formatDuration,
  formatMinutes,
  getTimerTone,
  type TimerThresholds,
  type TimerTone,
} from "@/lib/exam/time";
import { cn } from "@/lib/utils";

const TONE: Record<
  TimerTone,
  { box: string; icon: string; digits: string; bar: string; announce?: string }
> = {
  normal: {
    box: "border-slate-200/80 bg-white",
    icon: "bg-brand-soft text-brand",
    digits: "text-navy",
    bar: "bg-brand",
  },
  warning: {
    box: "border-amber-200 bg-amber-50/70",
    icon: "bg-amber-100 text-amber-700",
    digits: "text-amber-800",
    bar: "bg-amber-500",
    announce: "Less than 10 minutes remaining.",
  },
  critical: {
    box: "border-red-200 bg-red-50/70",
    icon: "bg-red-100 text-red-600",
    digits: "text-red-700",
    bar: "bg-red-500",
    announce: "Less than 5 minutes remaining.",
  },
  expired: {
    box: "border-red-200 bg-red-50/70",
    icon: "bg-red-100 text-red-600",
    digits: "text-red-700",
    bar: "bg-red-500",
    announce: "Exam session has expired.",
  },
};

interface ExamTimerProps {
  /** Derived from the server-issued end time; null until the clock has mounted. */
  remainingSeconds: number | null;
  durationSeconds: number;
  /** True once the exam itself has started on the server. Before that the timer doesn't run. */
  running: boolean;
  thresholds?: TimerThresholds;
}

/**
 * Running: counts down to the server deadline.
 * Not running (pre-exam steps): shows the time the candidate will get when they
 * start — the full duration, or less only if the exam window closes sooner.
 */
export function ExamTimer({
  remainingSeconds,
  durationSeconds,
  running,
  thresholds,
}: ExamTimerProps) {
  const shown =
    remainingSeconds === null
      ? null
      : running
        ? remainingSeconds
        : Math.min(durationSeconds, remainingSeconds);
  const windowCutsIn = shown !== null && shown < durationSeconds;
  const toneKey =
    shown === null || (!running && !windowCutsIn) ? "normal" : getTimerTone(shown, thresholds);
  const tone = TONE[toneKey];
  const progress = shown === null ? 1 : shown / durationSeconds;
  const Icon = toneKey === "expired" ? TimerOff : Clock;
  const label =
    toneKey === "expired" ? "Session Expired" : running ? "Time Remaining" : "Exam Duration";

  return (
    <div
      data-tone={toneKey}
      className={cn(
        "relative flex h-11 items-center gap-2.5 overflow-hidden rounded-xl border pl-2 pr-3.5 transition-colors",
        tone.box,
      )}
    >
      <span className={cn("grid h-7 w-7 place-items-center rounded-lg", tone.icon)}>
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="leading-none">
        <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
        <p className="mt-1 flex items-baseline gap-1">
          <span
            role="timer"
            data-running={running}
            aria-label={running ? "Time remaining" : "Exam duration"}
            className={cn("text-[15px] font-extrabold tabular-nums tracking-tight", tone.digits)}
          >
            {running || windowCutsIn
              ? shown === null
                ? "--:--:--"
                : formatDuration(shown)
              : formatMinutes(durationSeconds)}
          </span>
          {(running || windowCutsIn) && (
            <span className="text-[10px] font-semibold tabular-nums text-slate-500">
              of {formatDuration(durationSeconds)}
            </span>
          )}
        </p>
      </div>
      {(running || windowCutsIn) && (
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-slate-100">
          <span
            className={cn("block h-full transition-[width] duration-1000 ease-linear", tone.bar)}
            style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }}
          />
        </span>
      )}
      <span className="sr-only" aria-live="polite">
        {tone.announce}
      </span>
    </div>
  );
}

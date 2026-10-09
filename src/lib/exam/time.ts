export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
}

/** A duration as whole minutes, e.g. "90 Minutes". */
export function formatMinutes(totalSeconds: number): string {
  const minutes = Math.round(totalSeconds / 60);
  return `${minutes} ${minutes === 1 ? "Minute" : "Minutes"}`;
}

/** Seconds left until a server-issued deadline. Never negative. */
export function secondsUntil(deadlineMs: number, nowMs: number = Date.now()): number {
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

export type TimerTone = "normal" | "warning" | "critical" | "expired";

export interface TimerThresholds {
  /** Seconds remaining at which the timer turns amber. */
  warningAt: number;
  /** Seconds remaining at which the timer turns red. */
  criticalAt: number;
}

export const DEFAULT_TIMER_THRESHOLDS: TimerThresholds = {
  warningAt: 10 * 60,
  criticalAt: 5 * 60,
};

export function getTimerTone(
  remainingSeconds: number,
  thresholds: TimerThresholds = DEFAULT_TIMER_THRESHOLDS,
): TimerTone {
  if (remainingSeconds <= 0) return "expired";
  if (remainingSeconds <= thresholds.criticalAt) return "critical";
  if (remainingSeconds <= thresholds.warningAt) return "warning";
  return "normal";
}

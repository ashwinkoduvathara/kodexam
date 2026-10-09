import { useEffect, useMemo, useState } from "react";
import { secondsUntil } from "@/lib/exam/time";

/**
 * Countdown to the server-issued `examEndTime`.
 *
 * Recomputed from the wall clock every second (remaining = examEndTime − now),
 * so throttled background tabs and sleep/resume can't make it drift. It never
 * goes negative. `remainingSeconds` is null until mounted, to avoid SSR mismatches.
 */
export function useExamClock(examEndTime: string) {
  const deadline = useMemo(() => Date.parse(examEndTime), [examEndTime]);
  const [remainingSeconds, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setRemaining(secondsUntil(deadline));
    tick();
    const id = window.setInterval(tick, 1000);
    // Re-sync immediately when the tab becomes visible again.
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [deadline]);

  return { remainingSeconds, expired: remainingSeconds === 0 };
}

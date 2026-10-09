import { useEffect, useRef, useState } from "react";
import type { SystemCheckId, SystemCheckStates } from "@/lib/exam/types";
import { CHECK_LABEL, statusLabel } from "./status";

/**
 * Single polite live region announcing check status changes to screen readers
 * (e.g. "Camera: Working Properly"), instead of every badge being its own region.
 */
export function StatusAnnouncer({
  requiredChecks,
  states,
}: {
  requiredChecks: SystemCheckId[];
  states: SystemCheckStates;
}) {
  const previous = useRef<Record<string, string>>({});
  const [message, setMessage] = useState("");

  useEffect(() => {
    const changes: string[] = [];
    for (const id of requiredChecks) {
      const label = statusLabel(states[id]);
      if (previous.current[id] !== undefined && previous.current[id] !== label) {
        const title = states[id].message?.title;
        changes.push(`${CHECK_LABEL[id]}: ${label}${title ? `. ${title}` : ""}`);
      }
      previous.current[id] = label;
    }
    if (changes.length) setMessage(changes.join(". "));
  }, [requiredChecks, states]);

  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}

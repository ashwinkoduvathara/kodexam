import { CircleX, ShieldAlert } from "lucide-react";
import { getFlaggedActivities } from "@/lib/exam/policy";
import type { ProctoringPolicy, SecurityPolicy } from "@/types/exam";
import { SectionHeading } from "./SectionHeading";

/** Informs, never accuses: activities are "flagged for review", not "cheating". */
export function ProhibitedActivities({
  proctoringPolicy,
  securityPolicy,
}: {
  proctoringPolicy: ProctoringPolicy;
  securityPolicy: SecurityPolicy;
}) {
  const activities = getFlaggedActivities(proctoringPolicy, securityPolicy);
  return (
    <section
      aria-labelledby="flagged-heading"
      className="flex flex-1 flex-col rounded-2xl border border-red-200/70 bg-red-50/50 p-4"
    >
      <SectionHeading
        id="flagged-heading"
        icon={ShieldAlert}
        tone="danger"
        title="Activities That May Be Flagged"
        description="The following activities may be flagged for review during your examination attempt."
      />
      <ul
        className="mt-2.5 grid grid-flow-col grid-cols-2 gap-x-3 gap-y-1"
        style={{ gridTemplateRows: `repeat(${Math.ceil(activities.length / 2)}, auto)` }}
      >
        {activities.map((a) => (
          <li
            key={a.id}
            className="flex items-start gap-1.5 text-[11px] leading-snug text-slate-700"
          >
            <CircleX className="mt-px h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden />
            {a.label}
          </li>
        ))}
      </ul>
      <p className="mt-auto pt-2 text-[10.5px] leading-snug text-slate-600">
        KProctor may record security events during your attempt. Flagged events are reviewed
        according to the examination policy.
      </p>
    </section>
  );
}

import { LockKeyhole, Maximize2, Mic, Monitor, Video, type LucideIcon } from "lucide-react";
import { describeProctoringPolicy, type PolicyItem } from "@/lib/exam/policy";
import type { ProctoringPolicy } from "@/types/exam";
import { cn } from "@/lib/utils";
import { SectionHeading } from "./SectionHeading";

const ICONS: Record<PolicyItem["id"], LucideIcon> = {
  camera: Video,
  microphone: Mic,
  screen: Monitor,
  fullscreen: Maximize2,
};

export function ProctoringInformation({
  policy,
  title = "Secure Examination Environment",
  description = "To maintain examination integrity, KProctor may monitor your camera, microphone, screen activity and browser environment according to the examination policy.",
  roomy = false,
}: {
  policy: ProctoringPolicy;
  title?: string;
  description?: string;
  /** Larger tiles (Start Exam), matching that screen's denser-information layout. */
  roomy?: boolean;
}) {
  const items = describeProctoringPolicy(policy);
  return (
    <section
      aria-labelledby="proctoring-heading"
      className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm"
    >
      <SectionHeading
        id="proctoring-heading"
        icon={LockKeyhole}
        title={title}
        description={description}
      />
      <ul className={cn("mt-3 grid grid-cols-2", roomy ? "gap-2.5" : "gap-2")}>
        {items.map((item) => {
          const Icon = ICONS[item.id];
          return (
            <li
              key={item.id}
              data-policy={item.id}
              className={cn(
                "flex min-w-0 items-center gap-2.5 rounded-xl bg-slate-50",
                roomy ? "border border-slate-100 px-3 py-3" : "px-2.5 py-2",
              )}
            >
              <span
                className={cn(
                  "grid shrink-0 place-items-center rounded-lg",
                  roomy ? "h-10 w-10" : "h-8 w-8",
                  item.active ? "bg-brand-soft text-brand" : "bg-slate-100 text-slate-400",
                )}
              >
                <Icon className={roomy ? "h-5 w-5" : "h-4.5 w-4.5"} aria-hidden />
              </span>
              <div className="min-w-0 leading-tight">
                <p
                  className={cn(
                    "truncate text-navy",
                    roomy ? "text-[13px] font-medium" : "text-[11px] font-semibold",
                  )}
                  title={item.label}
                >
                  {item.label}
                </p>
                <p
                  className={cn(
                    roomy ? "mt-1 text-[13px] font-bold" : "mt-0.5 text-[11px] font-bold",
                    item.active ? "text-brand-strong" : "text-slate-500",
                  )}
                >
                  {item.state}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

import { Clock3, ShieldAlert, ShieldCheck } from "lucide-react";
import type { StartEligibility } from "@/lib/exam/start-eligibility";
import { cn } from "@/lib/utils";

/**
 * Top-right status. Reflects the server session: success is shown only when
 * every pre-exam step is complete, never while identity review is pending.
 */
export function ReadyStatusCard({ eligibility }: { eligibility: StartEligibility }) {
  const view = eligibility.canStart
    ? eligibility.identityUnderReview
      ? {
          icon: Clock3,
          tone: "info" as const,
          title: "Ready to start · identity under review",
          text: "Your system check and instructions are complete. Your identity verification is still under review; this exam's policy allows you to start while the review continues.",
        }
      : {
          icon: ShieldCheck,
          tone: "success" as const,
          title: "All checks complete",
          text: "Your system, instructions and identity verification are complete. You can now start your examination.",
        }
    : {
        icon: ShieldAlert,
        tone: "neutral" as const,
        title: "Not ready to start",
        text: eligibility.reason ?? "Complete the previous steps before starting the exam.",
      };
  const Icon = view.icon;

  return (
    <div
      role="status"
      data-ready-status={view.tone}
      className={cn(
        "flex w-[400px] max-w-full shrink-0 items-start gap-3.5 rounded-2xl border px-4 py-3.5",
        view.tone === "success" && "border-brand/20 bg-brand-soft/70",
        view.tone === "info" && "border-sky-200/70 bg-sky-50/70",
        view.tone === "neutral" && "border-slate-200 bg-slate-50",
      )}
    >
      <span
        className={cn(
          "grid h-11 w-11 shrink-0 place-items-center rounded-xl",
          view.tone === "success" && "bg-brand text-white",
          view.tone === "info" && "bg-sky-100 text-sky-700",
          view.tone === "neutral" && "bg-slate-200/70 text-slate-600",
        )}
      >
        <Icon className="h-5.5 w-5.5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p
          className={cn(
            "text-sm font-bold",
            view.tone === "success" ? "text-brand-strong" : "text-navy",
          )}
        >
          {view.title}
        </p>
        <p className="mt-1 text-xs leading-snug text-slate-600">{view.text}</p>
      </div>
    </div>
  );
}

import { forwardRef, useId, type ReactNode } from "react";
import { RotateCcw, type LucideIcon } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isCheckBlocked, type CheckState, type SystemCheckId } from "@/lib/exam/types";
import { cn } from "@/lib/utils";
import { CheckStatusBadge } from "./CheckStatusBadge";

interface SystemCheckCardProps {
  checkId: SystemCheckId;
  icon: LucideIcon;
  /** Icon shown in the issue panel when the check is blocked. */
  issueIcon: LucideIcon;
  title: string;
  description: string;
  state: CheckState;
  /** The live test UI. Replaced by the issue panel while the check is blocked. */
  children: ReactNode;
  /** Keep children mounted (hidden) while blocked, so refs like <video> survive. */
  persistentChildren?: boolean;
  /** Render the blocked message inside the test UI instead of replacing it. */
  inlineIssue?: boolean;
  footer?: ReactNode;
}

/** Shared shell for every device check: header, status, test area, action. */
export function SystemCheckCard({
  checkId,
  icon: Icon,
  issueIcon,
  title,
  description,
  state,
  children,
  persistentChildren = false,
  inlineIssue = false,
  footer,
}: SystemCheckCardProps) {
  const headingId = useId();
  const blocked = isCheckBlocked(state);
  const failed = state.status === "failed";
  const showIssue = blocked && !!state.message && !inlineIssue;

  return (
    <section
      aria-labelledby={headingId}
      data-check={checkId}
      data-status={state.status}
      data-reason={state.reason}
      className={cn(
        "flex min-w-0 flex-col rounded-2xl border bg-white p-4 shadow-sm transition-colors short:p-3.5",
        blocked ? (failed ? "border-red-200" : "border-amber-200") : "border-slate-200/70",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            "grid h-10 w-10 shrink-0 place-items-center rounded-xl transition-colors",
            blocked
              ? failed
                ? "bg-red-50 text-red-600"
                : "bg-amber-50 text-amber-600"
              : "bg-brand-soft text-brand",
          )}
        >
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <CheckStatusBadge state={state} />
      </div>

      <h3 id={headingId} className="mt-3 text-[15px] font-bold text-navy short:mt-2.5">
        {title}
      </h3>
      <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{description}</p>

      <div className="mt-3 flex flex-1 flex-col short:mt-2.5">
        {showIssue && (
          <CheckIssuePanel
            icon={issueIcon}
            tone={failed ? "danger" : "warning"}
            {...state.message!}
          />
        )}
        {(!showIssue || persistentChildren) && (
          <div className={cn("flex flex-1 flex-col", showIssue && "hidden")}>{children}</div>
        )}
      </div>

      {footer && <div className="mt-3 short:mt-2.5">{footer}</div>}
    </section>
  );
}

function CheckIssuePanel({
  icon: Icon,
  tone,
  title,
  description,
}: {
  icon: LucideIcon;
  tone: "danger" | "warning";
  title: string;
  description: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col items-center justify-center rounded-xl border px-4 py-5 text-center",
        tone === "danger" ? "border-red-100 bg-red-50/40" : "border-amber-100 bg-amber-50/40",
      )}
    >
      <span
        className={cn(
          "grid h-10 w-10 place-items-center rounded-full bg-white shadow-sm ring-1",
          tone === "danger" ? "text-red-500 ring-red-100" : "text-amber-600 ring-amber-100",
        )}
      >
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <p className="mt-3 text-[13px] font-bold text-navy">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">{description}</p>
    </div>
  );
}

/** Inline (non-replacing) message, e.g. for the speaker "not heard" state. */
export function InlineCheckMessage({
  tone,
  title,
  description,
}: {
  tone: "danger" | "warning";
  title: string;
  description: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-2.5 py-2",
        tone === "danger" ? "border-red-100 bg-red-50/60" : "border-amber-100 bg-amber-50/60",
      )}
    >
      <p className="text-[11px] font-bold text-navy">{title}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-slate-600">{description}</p>
    </div>
  );
}

/** Test well — the inset area that hosts each check's live readout. */
export function CheckWell({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col rounded-xl border border-slate-100 bg-slate-50/70 p-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CheckWellLabel({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
        {children}
      </span>
      {aside}
    </div>
  );
}

/** Card footer action. Switches to the primary (green) style when the check needs a retry. */
export const CheckAction = forwardRef<
  HTMLButtonElement,
  ButtonProps & { icon?: LucideIcon; emphasis?: boolean }
>(({ icon: Icon, emphasis = false, className, children, ...props }, ref) => (
  <Button
    ref={ref}
    variant={emphasis ? "default" : "outline"}
    className={cn(
      "h-10 w-full rounded-xl text-xs font-bold",
      emphasis ? "shadow-sm" : "border-slate-200 text-navy shadow-none hover:border-slate-300",
      className,
    )}
    {...props}
  >
    {Icon && <Icon aria-hidden />}
    {children}
  </Button>
));
CheckAction.displayName = "CheckAction";

/** Square icon button used next to a device picker to re-run a check. */
export function RetestButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          className="h-10 w-10 shrink-0 rounded-xl border-slate-200 text-slate-600 shadow-none"
        >
          <RotateCcw />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="bg-navy text-white">{label}</TooltipContent>
    </Tooltip>
  );
}

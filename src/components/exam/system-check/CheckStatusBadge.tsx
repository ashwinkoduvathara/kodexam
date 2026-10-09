import type { CheckState } from "@/lib/exam/types";
import { cn } from "@/lib/utils";
import { STATUS_STYLE, statusLabel } from "./status";

export function CheckStatusBadge({ state, className }: { state: CheckState; className?: string }) {
  const style = STATUS_STYLE[state.status];
  const Icon = style.icon;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full py-1 pl-1.5 pr-2.5 text-[10px] font-bold whitespace-nowrap",
        style.badge,
        className,
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", style.spin && "animate-spin")} aria-hidden />
      {statusLabel(state)}
    </span>
  );
}

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Card heading with the mint icon tile used across the instructions screen. */
export function SectionHeading({
  id,
  icon: Icon,
  title,
  description,
  tone = "brand",
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  description?: string;
  tone?: "brand" | "danger" | "info";
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
          tone === "brand" && "bg-brand-soft text-brand",
          tone === "danger" && "bg-red-100/80 text-red-600",
          tone === "info" && "bg-sky-100 text-sky-600",
        )}
      >
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <h2
          id={id}
          className={cn(
            "text-base font-bold leading-tight",
            tone === "danger" ? "text-red-700" : "text-navy",
          )}
        >
          {title}
        </h2>
        {description && <p className="mt-1 text-xs leading-snug text-slate-600">{description}</p>}
      </div>
    </div>
  );
}

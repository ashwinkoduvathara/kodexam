import { useState } from "react";
import {
  CircleAlert,
  CircleCheck,
  Info,
  ScanFace,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ProctoringEventItem, ProctoringSeverity } from "@/types/paper";
import { cn } from "@/lib/utils";

const SEVERITY: Record<
  ProctoringSeverity,
  { icon: LucideIcon; box: string; icon_: string; title: string; name: string }
> = {
  HIGH: {
    icon: CircleAlert,
    box: "border-red-200 bg-red-50/70",
    icon_: "text-red-600",
    title: "text-red-700",
    name: "High",
  },
  MEDIUM: {
    icon: TriangleAlert,
    box: "border-amber-200 bg-amber-50/70",
    icon_: "text-amber-600",
    title: "text-amber-800",
    name: "Medium",
  },
  LOW: {
    icon: Info,
    box: "border-slate-200 bg-slate-50",
    icon_: "text-slate-500",
    title: "text-navy",
    name: "Low",
  },
  INFO: {
    icon: CircleCheck,
    box: "border-slate-200 bg-slate-50",
    icon_: "text-brand",
    title: "text-navy",
    name: "Information",
  },
};

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function EventRow({ event }: { event: ProctoringEventItem }) {
  const s = SEVERITY[event.severity];
  return (
    <li
      data-event={event.type}
      className={cn("flex items-start gap-2.5 rounded-xl border px-3 py-2", s.box)}
    >
      <s.icon className={cn("mt-0.5 h-4.5 w-4.5 shrink-0", s.icon_)} aria-hidden />
      <div className="min-w-0 flex-1 leading-snug">
        <p className={cn("text-[12px] font-bold", s.title)}>
          {event.label}
          <span className="sr-only"> (severity: {s.name})</span>
        </p>
        <p className="text-[11px] text-slate-600 short:hidden">{event.description}</p>
      </div>
      <time
        dateTime={event.occurredAt}
        className="shrink-0 text-[10px] font-semibold text-slate-500"
      >
        {time(event.occurredAt)}
      </time>
    </li>
  );
}

interface ProctoringAlertsProps {
  events: ProctoringEventItem[];
  total: number;
  loadError: string | null;
  onViewAll: () => Promise<ProctoringEventItem[]>;
}

/**
 * Real events recorded by the server for this attempt. No automated face or
 * gaze analysis runs, and the card says so rather than implying it does.
 */
export function ProctoringAlerts({ events, total, loadError, onViewAll }: ProctoringAlertsProps) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState<ProctoringEventItem[] | null>(null);
  const [allError, setAllError] = useState<string | null>(null);

  const openAll = async () => {
    setOpen(true);
    setAllError(null);
    try {
      setAll(await onViewAll());
    } catch {
      setAllError("Couldn't load the event history. Try again shortly.");
    }
  };

  return (
    <section
      aria-labelledby="alerts-heading"
      className="shrink-0 rounded-2xl border border-slate-200/70 bg-white p-3.5 shadow-sm"
    >
      <div className="flex items-center justify-between">
        <h2 id="alerts-heading" className="flex items-center gap-1.5 text-sm font-bold text-navy">
          AI Proctoring Alerts
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="About these alerts"
                className="rounded-full text-slate-400 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                <Info className="h-3.5 w-3.5" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-64 bg-navy text-white">
              Events your browser observed and the exam server recorded, such as the camera
              disconnecting or fullscreen being exited. They're reviewed according to the exam
              policy.
            </TooltipContent>
          </Tooltip>
        </h2>
        <button
          type="button"
          onClick={() => void openAll()}
          className="rounded text-xs font-bold text-sky-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          View all{total > 0 ? ` (${total})` : ""}
        </button>
      </div>

      <p
        data-face-detection="unavailable"
        className="mt-2.5 flex items-start gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-3 py-2 text-[11px] leading-snug text-slate-600"
      >
        <ScanFace className="mt-px h-4 w-4 shrink-0 text-slate-400" aria-hidden />
        <span>
          <span className="font-bold text-slate-700">Face detection unavailable.</span> Automated
          face and gaze analysis isn't enabled for this exam.
        </span>
      </p>

      <div aria-live="polite">
        {loadError ? (
          <p className="mt-2 text-[11px] font-semibold text-red-700">{loadError}</p>
        ) : events.length === 0 ? (
          <p className="mt-2 px-1 text-[11px] text-slate-500">No events recorded.</p>
        ) : (
          <ul className="mt-2 space-y-1.5 short:[&>li:nth-child(n+3)]:hidden">
            {events.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </ul>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="kp max-w-lg rounded-2xl bg-white p-5">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-navy">Recorded events</DialogTitle>
            <DialogDescription className="text-xs text-slate-600">
              Everything recorded for this exam so far, newest first.
            </DialogDescription>
          </DialogHeader>
          {allError ? (
            <p role="alert" className="text-xs font-semibold text-red-700">
              {allError}
            </p>
          ) : all === null ? (
            <p className="text-xs text-slate-500">Loading…</p>
          ) : all.length === 0 ? (
            <p className="text-xs text-slate-500">No events recorded.</p>
          ) : (
            <ul className="max-h-[60vh] space-y-1.5 overflow-y-auto pr-1">
              {all.map((e) => (
                <EventRow key={e.id} event={e} />
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

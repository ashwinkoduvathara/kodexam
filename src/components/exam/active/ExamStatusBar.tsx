import {
  Maximize2,
  Mic,
  Monitor,
  ShieldCheck,
  Video,
  Volume2,
  type LucideIcon,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DeviceStatus } from "@/hooks/use-exam-monitoring";
import type { ProctoringPolicy } from "@/types/exam";
import { cn } from "@/lib/utils";

type Tone = "ok" | "warn" | "fail" | "neutral";
interface StatusItem {
  id: string;
  icon: LucideIcon;
  label: string;
  value: string;
  tone: Tone;
  hint: string;
}

const DEVICE_COPY: Record<DeviceStatus, { value: string; tone: Tone }> = {
  live: { value: "ON", tone: "ok" },
  starting: { value: "Starting", tone: "warn" },
  stalled: { value: "No Signal", tone: "warn" },
  disconnected: { value: "Disconnected", tone: "fail" },
  blocked: { value: "Blocked", tone: "fail" },
  unavailable: { value: "Unavailable", tone: "fail" },
  not_required: { value: "Not Required", tone: "neutral" },
};

const DOT: Record<Tone, string> = {
  ok: "bg-brand",
  warn: "bg-amber-500",
  fail: "bg-red-500",
  neutral: "bg-slate-300",
};
const TEXT: Record<Tone, string> = {
  ok: "text-brand-strong",
  warn: "text-amber-700",
  fail: "text-red-600",
  neutral: "text-slate-500",
};

interface ExamStatusBarProps {
  policy: ProctoringPolicy;
  camera: DeviceStatus;
  microphone: DeviceStatus;
  fullscreen: { supported: boolean; active: boolean };
  onEnterFullscreen: () => void;
}

/**
 * Fixed bottom bar. Every value is the real state: live tracks for camera and
 * microphone, the Fullscreen API for fullscreen. Features KProctor can't
 * observe say so instead of showing a false "ON".
 */
export function ExamStatusBar({
  policy,
  camera,
  microphone,
  fullscreen,
  onEnterFullscreen,
}: ExamStatusBarProps) {
  const items: StatusItem[] = [
    {
      id: "camera",
      icon: Video,
      label: "Camera",
      ...DEVICE_COPY[camera],
      hint: "ON only while video frames are arriving from your camera.",
    },
    {
      id: "microphone",
      icon: Mic,
      label: "Microphone",
      ...DEVICE_COPY[microphone],
      hint: "ON while the microphone track is running and not muted by the system.",
    },
    {
      id: "speaker",
      icon: Volume2,
      label: "Speaker",
      value: "Tested",
      tone: "neutral",
      hint: "Checked during the system check. Speaker output can't be monitored continuously.",
    },
    {
      id: "screen",
      icon: Monitor,
      label: "Screen Monitoring",
      ...(policy.screenMonitoringRequired
        ? { value: "Unavailable", tone: "warn" as const }
        : { value: "Not Required", tone: "neutral" as const }),
      hint: policy.screenMonitoringRequired
        ? "Screen monitoring isn't available in this version of KProctor, so it isn't running."
        : "This exam doesn't use screen monitoring.",
    },
    {
      id: "fullscreen",
      icon: Maximize2,
      label: "Fullscreen",
      ...(!fullscreen.supported
        ? { value: "Unsupported", tone: policy.fullscreenRequired ? "fail" : "neutral" }
        : fullscreen.active
          ? { value: "ON", tone: "ok" }
          : policy.fullscreenRequired
            ? { value: "OFF", tone: "fail" }
            : { value: "Not Required", tone: "neutral" }),
      hint: policy.fullscreenRequired
        ? "This exam must run in fullscreen."
        : "Fullscreen is optional for this exam.",
    },
  ];

  return (
    <footer
      aria-label="Exam environment status"
      className="fixed inset-x-0 bottom-0 z-30 flex h-[68px] items-center gap-4 border-t border-slate-200/70 bg-white px-6 shadow-[0_-4px_16px_-12px_rgba(17,30,56,0.25)]"
    >
      <div className="flex min-w-0 shrink-0 items-center gap-3 pr-4 xl:w-[300px] 2xl:w-[380px]">
        <ShieldCheck className="h-7 w-7 shrink-0 text-brand" aria-hidden />
        <div className="min-w-0 leading-tight">
          <p className="text-[13px] font-bold text-navy">Secure Exam Environment</p>
          <p className="mt-0.5 hidden text-[11px] leading-snug text-slate-500 xl:line-clamp-2">
            Your examination is being monitored according to the exam policy.
          </p>
        </div>
      </div>

      <ul className="flex min-w-0 flex-1 items-center justify-between divide-x divide-slate-100">
        {items.map((item) => (
          <li key={item.id} className="flex flex-1 justify-center px-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  tabIndex={0}
                  data-status-item={item.id}
                  data-tone={item.tone}
                  aria-label={`${item.label}: ${item.value}`}
                  className="flex cursor-default items-center gap-2.5 rounded-lg px-1.5 py-1 outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  <item.icon className="h-5 w-5 shrink-0 text-slate-600" aria-hidden />
                  <div className="leading-tight">
                    <p className="text-[12px] font-bold text-navy">{item.label}</p>
                    <p
                      className={cn(
                        "mt-0.5 flex items-center gap-1.5 text-[11px] font-bold",
                        TEXT[item.tone],
                      )}
                    >
                      <span
                        className={cn("h-1.5 w-1.5 rounded-full", DOT[item.tone])}
                        aria-hidden
                      />
                      {item.value}
                    </p>
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-60 bg-navy text-center text-white">
                {item.hint}
              </TooltipContent>
            </Tooltip>
          </li>
        ))}
      </ul>

      {fullscreen.supported && !fullscreen.active && (
        <button
          type="button"
          onClick={onEnterFullscreen}
          className="flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-bold text-navy transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          <Maximize2 className="h-4.5 w-4.5" aria-hidden />
          Full Screen
        </button>
      )}
    </footer>
  );
}

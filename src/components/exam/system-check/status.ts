import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import type { CheckState, SystemCheckId, SystemCheckStatus } from "@/lib/exam/types";

/** Status is always conveyed by icon + text + colour — never colour alone. */
export const STATUS_STYLE: Record<
  SystemCheckStatus,
  { badge: string; icon: LucideIcon; label: string; spin?: boolean }
> = {
  idle: { badge: "bg-slate-100 text-slate-600", icon: CircleDashed, label: "Not Tested" },
  checking: {
    badge: "bg-slate-100 text-slate-600",
    icon: Loader2,
    label: "Checking…",
    spin: true,
  },
  passed: { badge: "bg-brand-soft text-brand-strong", icon: CheckCircle2, label: "Passed" },
  warning: { badge: "bg-amber-50 text-amber-800", icon: AlertTriangle, label: "Needs Attention" },
  failed: { badge: "bg-red-50 text-red-700", icon: AlertCircle, label: "Check Failed" },
  not_available: {
    badge: "bg-amber-50 text-amber-800",
    icon: AlertTriangle,
    label: "Not Available",
  },
};

export function statusLabel(state: CheckState) {
  return state.label ?? STATUS_STYLE[state.status].label;
}

export const CHECK_LABEL: Record<SystemCheckId, string> = {
  camera: "Camera",
  microphone: "Microphone",
  speaker: "Speaker",
  network: "Internet",
};

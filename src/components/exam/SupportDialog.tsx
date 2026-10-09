import type { ReactNode } from "react";
import { Clock, Headset, Mail, Phone } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SUPPORT_CONFIG, type SupportConfig } from "@/lib/exam/config";
import { supportMailto } from "@/lib/exam/support";
import type { ExamSession } from "@/lib/exam/types";

interface SupportDialogProps {
  session: ExamSession;
  support?: SupportConfig;
  /** Optional trigger element; omit and control with `open` / `onOpenChange` instead. */
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function SupportDialog({
  session,
  support = SUPPORT_CONFIG,
  children,
  open,
  onOpenChange,
}: SupportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="kp max-w-md gap-0 rounded-2xl border-slate-200 bg-white p-6">
        <DialogHeader className="space-y-2 text-left">
          <span className="mb-1 grid h-11 w-11 place-items-center rounded-xl bg-brand-soft text-brand">
            <Headset className="h-5 w-5" aria-hidden />
          </span>
          <DialogTitle className="text-lg font-extrabold text-navy">Technical Support</DialogTitle>
          <DialogDescription className="text-sm text-slate-600">
            Having trouble completing the system check?
          </DialogDescription>
        </DialogHeader>

        <dl className="mt-5 divide-y divide-slate-100 rounded-xl border border-slate-200/70">
          <ContactRow icon={<Mail className="h-4 w-4" />} label="Email">
            <a
              href={supportMailto(session, support)}
              className="font-bold text-brand-strong underline-offset-2 hover:underline"
            >
              {support.email}
            </a>
          </ContactRow>
          <ContactRow icon={<Phone className="h-4 w-4" />} label="Support phone">
            <a
              href={`tel:${support.phone.replace(/[^\d+]/g, "")}`}
              className="font-bold text-brand-strong underline-offset-2 hover:underline"
            >
              {support.phone}
            </a>
          </ContactRow>
          <ContactRow icon={<Clock className="h-4 w-4" />} label="Support hours">
            <span className="font-semibold text-navy">{support.hours}</span>
          </ContactRow>
        </dl>

        <div className="mt-4 rounded-xl bg-slate-50 px-3.5 py-3 text-xs text-slate-600">
          <p className="font-bold text-navy">Share these details with support</p>
          <p className="mt-1">
            Roll No: <span className="font-semibold text-navy">{session.rollNumber}</span>
            <span className="mx-1.5 text-slate-300">·</span>
            Attempt ID:{" "}
            <span className="font-mono text-[11px] font-semibold text-navy">
              {session.attemptId}
            </span>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ContactRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-3 text-sm">
      <span className="text-slate-500" aria-hidden>
        {icon}
      </span>
      <dt className="w-28 shrink-0 text-xs font-semibold text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

import { TimerOff } from "lucide-react";
import { SupportDialog } from "../SupportDialog";
import type { ExamSession } from "@/lib/exam/types";

export function SessionExpiredNotice({ session }: { session: ExamSession }) {
  return (
    <div
      role="alert"
      className="mx-auto mt-6 flex max-w-lg flex-col items-center rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm"
    >
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-red-50 text-red-600">
        <TimerOff className="h-7 w-7" aria-hidden />
      </span>
      <h2 className="mt-5 text-xl font-extrabold text-navy">Exam session has expired.</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        The time window for this exam has ended, so the system check can no longer be completed.
        Your camera and microphone have been turned off.
      </p>
      <SupportDialog session={session}>
        <button
          type="button"
          className="mt-6 inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-xs font-bold text-brand-strong shadow-sm transition hover:border-brand/30 hover:bg-brand-soft"
        >
          Contact Support
        </button>
      </SupportDialog>
    </div>
  );
}

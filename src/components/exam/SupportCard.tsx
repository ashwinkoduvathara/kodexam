import { ArrowRight, Headset } from "lucide-react";
import type { ExamSession } from "@/lib/exam/types";
import { SupportDialog } from "./SupportDialog";

export function SupportCard({ session }: { session: ExamSession }) {
  return (
    <section
      aria-labelledby="support-card-heading"
      className="rounded-2xl border border-slate-200/70 bg-slate-50/60 p-4"
    >
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-brand shadow-sm ring-1 ring-slate-200/70">
          <Headset className="h-4 w-4" aria-hidden />
        </span>
        <h2 id="support-card-heading" className="text-sm font-bold text-navy">
          Need help?
        </h2>
      </div>
      <p className="mt-2.5 text-xs leading-relaxed text-slate-600">
        If you face any issues during the system check, please contact our support team.
      </p>
      <SupportDialog session={session}>
        <button
          type="button"
          className="mt-3.5 flex h-9 w-full items-center justify-center gap-2 border border-slate-200 bg-white text-xs font-bold text-brand-strong shadow-sm transition hover:border-brand/30 hover:bg-brand-soft"
        >
          Contact Support
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      </SupportDialog>
    </section>
  );
}

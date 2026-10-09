import { ShieldCheck } from "lucide-react";

export function SecurityBanner({
  title = "Secure Exam Environment",
  description = "Your exam is protected by AI proctoring.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex max-w-[400px] items-center gap-3 rounded-2xl border border-slate-200/70 bg-white py-3 pl-3 pr-5 shadow-sm short:py-2">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
        <ShieldCheck className="h-5 w-5" aria-hidden />
      </span>
      <div className="leading-tight">
        <p className="flex items-center gap-2 text-[13px] font-bold text-navy">
          {title}
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-brand-strong">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden />
            Active
          </span>
        </p>
        <p className="mt-1 text-xs leading-snug text-slate-500">{description}</p>
      </div>
    </div>
  );
}

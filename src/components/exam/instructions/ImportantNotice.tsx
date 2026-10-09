import { CircleAlert } from "lucide-react";

export function ImportantNotice({ allowPause }: { allowPause: boolean }) {
  return (
    <section
      aria-labelledby="important-notice-heading"
      className="flex items-start gap-4 rounded-2xl border border-amber-200/70 bg-amber-50/70 px-5 py-3 short:py-2.5"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-700">
        <CircleAlert className="h-5 w-5" aria-hidden />
      </span>
      <div>
        <h2 id="important-notice-heading" className="text-[15px] font-bold text-navy">
          Important
        </h2>
        <p className="mt-0.5 text-sm leading-relaxed text-slate-700">
          Once you start the examination, the timer will begin. You must complete and submit the
          exam within the allotted time.
        </p>
        {!allowPause && (
          <p className="mt-1 text-xs text-slate-600">
            You cannot pause the examination once it has started.
          </p>
        )}
      </div>
    </section>
  );
}

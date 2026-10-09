import { Check, Lightbulb } from "lucide-react";

const TIPS = [
  "Ensure you are in a quiet place with good lighting.",
  "Keep your device charged or connected to power.",
  "Close unnecessary tabs and applications.",
  "Do not switch to another window or tab during the exam.",
];

export function ExamTips() {
  return (
    <section
      aria-labelledby="exam-tips-heading"
      className="flex h-full gap-3.5 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm short:p-3.5"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
        <Lightbulb className="h-4.5 w-4.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <h2 id="exam-tips-heading" className="text-[13px] font-bold text-navy">
          Tips for a smooth exam experience
        </h2>
        <ul className="mt-2.5 grid grid-cols-1 gap-x-6 gap-y-2 xl:grid-cols-2 short:gap-y-1.5">
          {TIPS.map((tip) => (
            <li key={tip} className="flex items-start gap-2 text-xs leading-snug text-slate-600">
              <span className="mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
                <Check className="h-2.5 w-2.5" strokeWidth={3.5} aria-hidden />
              </span>
              {tip}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

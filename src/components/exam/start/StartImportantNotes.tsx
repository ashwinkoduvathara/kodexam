import { Info } from "lucide-react";
import { SectionHeading } from "../instructions/SectionHeading";

const NOTES = [
  "Make sure you are in a quiet and well-lit environment.",
  "Keep only permitted resources available.",
  "Do not use unauthorized devices.",
  "The examination is monitored according to its security policy.",
  "If you encounter a technical issue, contact support.",
];

export function StartImportantNotes() {
  return (
    <section
      aria-labelledby="start-notes-heading"
      className="flex-1 rounded-2xl border border-sky-100 bg-sky-50/60 p-4"
    >
      <SectionHeading id="start-notes-heading" icon={Info} tone="info" title="Important Notes" />
      <ul className="-mt-3 space-y-1.5 pl-[52px]">
        {NOTES.map((note) => (
          <li key={note} className="flex items-start gap-2 text-xs leading-snug text-slate-700">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" aria-hidden />
            {note}
          </li>
        ))}
      </ul>
    </section>
  );
}

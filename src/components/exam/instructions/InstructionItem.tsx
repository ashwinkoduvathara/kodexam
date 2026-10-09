import {
  BookOpen,
  Clock,
  Info,
  Monitor,
  ShieldCheck,
  Smartphone,
  User,
  Video,
  type LucideIcon,
} from "lucide-react";
import type { ExamInstruction, InstructionIcon } from "@/types/exam";

/** Whitelisted icon set exam authors can choose from. */
const ICONS: Record<InstructionIcon, LucideIcon> = {
  monitor: Monitor,
  camera: Video,
  user: User,
  book: BookOpen,
  smartphone: Smartphone,
  shield: ShieldCheck,
  clock: Clock,
  info: Info,
};

export function InstructionItem({ instruction }: { instruction: ExamInstruction }) {
  const Icon = ICONS[instruction.icon] ?? Info;
  return (
    <li className="flex gap-3.5 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3 short:py-2.5">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-navy">{instruction.title}</h3>
        <p className="mt-1 text-xs leading-snug text-slate-600">{instruction.description}</p>
      </div>
    </li>
  );
}

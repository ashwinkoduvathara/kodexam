import { useState } from "react";
import { ChevronDown, Headset } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ExamSession } from "@/lib/exam/types";
import { SupportDialog } from "./SupportDialog";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function CandidateMenu({ session }: { session: ExamSession }) {
  const [supportOpen, setSupportOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Candidate ${session.candidateName}, roll number ${session.rollNumber}`}
          className="flex cursor-pointer items-center gap-2.5 px-1.5 py-1 text-left transition hover:bg-slate-50"
        >
          {session.candidateAvatarUrl ? (
            <img
              src={session.candidateAvatarUrl}
              alt=""
              className="h-9 w-9 rounded-full object-cover ring-2 ring-brand-soft"
            />
          ) : (
            <span
              aria-hidden
              className="grid h-9 w-9 place-items-center rounded-full bg-navy text-xs font-bold text-white ring-2 ring-brand-soft"
            >
              {initials(session.candidateName)}
            </span>
          )}
          <span className="leading-tight" aria-hidden>
            <span className="block text-xs font-bold text-navy">{session.candidateName}</span>
            <span className="block text-[10px] font-medium text-slate-500">
              Roll No: {session.rollNumber}
            </span>
          </span>
          <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="kp w-64 rounded-xl p-1.5">
          <DropdownMenuLabel className="px-2 py-1.5">
            <p className="text-xs font-bold text-navy">{session.candidateName}</p>
            <p className="mt-0.5 text-[11px] font-medium text-slate-600">
              Roll No: {session.rollNumber}
            </p>
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-600">
              {session.examCode}
              <span className="font-sans text-slate-400">·</span>
              <span className="font-sans">{session.examName}</span>
            </p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setSupportOpen(true)}
            className="cursor-pointer rounded-lg text-xs font-semibold"
          >
            <Headset className="h-4 w-4 text-slate-500" aria-hidden />
            Contact Support
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SupportDialog session={session} open={supportOpen} onOpenChange={setSupportOpen} />
    </>
  );
}

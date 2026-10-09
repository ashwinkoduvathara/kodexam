import { ChevronRight, Home, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { EndAttemptResult } from "@/lib/exam/session/exam-session-service";
import type { ExamSession } from "@/lib/exam/types";
import { CandidateMenu } from "./CandidateMenu";
import { EndExamButton } from "./EndExamButton";
import { ExamTimer } from "./ExamTimer";

interface ExamHeaderProps {
  session: ExamSession;
  remainingSeconds: number | null;
  onEndExam: () => Promise<EndAttemptResult>;
  onExamEnded: () => void;
  /** "exam" (running exam): exam name and ID instead of the breadcrumb. */
  variant?: "steps" | "exam";
}

export function ExamHeader({
  session,
  remainingSeconds,
  onEndExam,
  onExamEnded,
  variant = "steps",
}: ExamHeaderProps) {
  const running = session.examStartedAt !== null;
  return (
    <header className="sticky top-0 z-40 flex h-16 w-full items-center border-b border-slate-200/70 bg-white select-none">
      {/* Brand — same width as the sidebar, like the LMS AdminNavbar */}
      <div className="flex h-full w-64 shrink-0 items-center border-r border-slate-100 px-6">
        <div className="flex flex-col gap-1">
          <Logo linked={false} className="h-7 sm:h-7" />
          <span className="flex items-center gap-1 pl-px text-[9px] font-bold uppercase tracking-[0.24em] text-slate-500">
            <ShieldCheck className="h-3 w-3 text-brand" aria-hidden />
            Exam Portal
          </span>
        </div>
      </div>

      <div className="flex h-full min-w-0 flex-1 items-center justify-between gap-6 px-6">
        {variant === "exam" ? (
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-bold text-navy">{session.examName}</p>
            <p className="mt-1 text-xs text-slate-500">
              Exam ID: <span className="font-bold text-brand-strong">{session.examCode}</span>
            </p>
          </div>
        ) : (
          /* Breadcrumb is informational only: leaving mid-exam shouldn't be one click away. */
          <nav aria-label="Breadcrumb" className="min-w-0">
            <ol className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
              <li className="flex items-center gap-1.5">
                <Home className="h-3.5 w-3.5" aria-hidden />
                Home
              </li>
              <li aria-hidden>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />
              </li>
              <li>My Exams</li>
              <li aria-hidden>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />
              </li>
              <li aria-current="page" className="flex min-w-0 items-center gap-2 text-navy">
                <span className="shrink-0 rounded-md bg-brand-soft px-1.5 py-0.5 font-mono text-[10px] font-semibold text-brand-strong">
                  {session.examCode}
                </span>
                <span className="truncate font-bold">{session.examName}</span>
              </li>
            </ol>
          </nav>
        )}

        <div className="flex shrink-0 items-center gap-3">
          <ExamTimer
            remainingSeconds={remainingSeconds}
            durationSeconds={session.examDurationSeconds}
            running={running}
          />

          <Tooltip>
            <TooltipTrigger asChild>
              <div
                tabIndex={0}
                aria-label={`Auto submit ${session.autoSubmit ? "on" : "off"}`}
                className="cursor-default rounded-md px-1 leading-none"
              >
                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
                  Auto Submit
                </p>
                <p className="mt-1.5 flex items-center gap-1.5 text-xs font-extrabold text-navy">
                  <span
                    className={
                      session.autoSubmit
                        ? "h-2 w-2 rounded-full bg-brand ring-[3px] ring-brand/15"
                        : "h-2 w-2 rounded-full bg-slate-300"
                    }
                    aria-hidden
                  />
                  {session.autoSubmit ? "ON" : "OFF"}
                </p>
              </div>
            </TooltipTrigger>
            <TooltipContent className="max-w-56 bg-navy text-center text-white">
              {session.autoSubmit
                ? "Your answers are submitted automatically when the timer reaches zero."
                : "Remember to submit your answers before the timer reaches zero."}
            </TooltipContent>
          </Tooltip>

          <EndExamButton
            onEndExam={onEndExam}
            onEnded={onExamEnded}
            mode={running ? "submit" : "end"}
          />

          <span aria-hidden className="h-8 w-px bg-slate-200" />

          <CandidateMenu session={session} />
        </div>
      </div>
    </header>
  );
}

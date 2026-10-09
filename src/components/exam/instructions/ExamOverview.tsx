import type { ReactNode } from "react";
import {
  ChartColumn,
  Clock,
  FileText,
  ListChecks,
  RefreshCcw,
  Tag,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { formatMinutes } from "@/lib/exam/time";
import type { ExamSession } from "@/lib/exam/types";
import { cn } from "@/lib/utils";
import { SectionHeading } from "./SectionHeading";

export function ExamOverview({
  session,
  description,
  iconTiles = false,
}: {
  session: ExamSession;
  description?: string;
  /** Show each stat's icon in a mint tile (Start Exam) instead of a bare icon (Instructions). */
  iconTiles?: boolean;
}) {
  const stats: { icon: LucideIcon; label: string; value: ReactNode }[] = [
    { icon: FileText, label: "Exam", value: session.examName },
    { icon: Tag, label: "Exam ID", value: session.examCode },
    { icon: Clock, label: "Duration", value: formatMinutes(session.examDurationSeconds) },
    { icon: ListChecks, label: "Questions", value: session.totalQuestions },
    { icon: ChartColumn, label: "Total Marks", value: session.totalMarks },
    { icon: Trophy, label: "Passing Marks", value: session.passingMarks },
    {
      icon: RefreshCcw,
      label: "Attempt",
      value: `${session.attemptNumber} of ${session.attemptLimit}`,
    },
  ];

  return (
    <section
      aria-labelledby="exam-overview-heading"
      className="rounded-2xl border border-slate-200/70 bg-white px-5 py-4 shadow-sm short:py-3.5"
    >
      <SectionHeading
        id="exam-overview-heading"
        icon={FileText}
        title="Exam Overview"
        description={description}
      />
      <dl
        className={cn(
          "mt-3 grid grid-cols-[1.5fr_repeat(6,minmax(0,1fr))] divide-x divide-slate-100 short:mt-3",
          iconTiles && "mt-4",
        )}
      >
        {stats.map(({ icon: Icon, label, value }) => (
          <div
            key={label}
            className={cn(
              "flex min-w-0 gap-2.5 px-4 first:pl-0 last:pr-0",
              iconTiles ? "items-center px-3" : "items-start",
            )}
          >
            {iconTiles ? (
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
                <Icon className="h-4.5 w-4.5" aria-hidden />
              </span>
            ) : (
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
            )}
            <div className="min-w-0">
              <dt className="text-xs font-medium text-slate-500">{label}</dt>
              <dd
                className="mt-1 truncate text-[13px] font-bold leading-snug text-navy"
                title={typeof value === "string" ? value : undefined}
                data-stat={label}
              >
                {value}
              </dd>
            </div>
          </div>
        ))}
      </dl>
    </section>
  );
}

import { useState } from "react";
import { Bookmark, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  QUESTION_STATUS_LABEL,
  questionStatus,
  summarize,
  type QuestionStatus,
} from "@/lib/exam/paper/question-state";
import type { AnswerState, ExamPaperResponse } from "@/types/paper";
import { cn } from "@/lib/utils";

const STYLE: Record<QuestionStatus, { cell: string; dot: string }> = {
  not_visited: { cell: "border-slate-200 bg-slate-100 text-slate-600", dot: "bg-slate-300" },
  not_answered: {
    cell: "border-slate-300 bg-white text-navy",
    dot: "border border-slate-400 bg-white",
  },
  answered: { cell: "border-brand bg-brand text-white", dot: "bg-brand" },
  marked: { cell: "border-amber-400 bg-amber-400 text-white", dot: "bg-amber-400" },
  answered_marked: { cell: "border-sky-500 bg-sky-500 text-white", dot: "bg-sky-500" },
};
const LEGEND_ORDER: QuestionStatus[] = [
  "not_visited",
  "not_answered",
  "answered",
  "marked",
  "answered_marked",
];

function Cell({
  number,
  status,
  current,
  onSelect,
}: {
  number: number;
  status: QuestionStatus;
  current: boolean;
  onSelect: () => void;
}) {
  const answered = status === "answered" || status === "answered_marked";
  const marked = status === "marked" || status === "answered_marked";
  return (
    <button
      type="button"
      onClick={onSelect}
      data-question-cell={number}
      data-status={status}
      aria-current={current ? "step" : undefined}
      aria-label={`Question ${number}: ${QUESTION_STATUS_LABEL[status]}${current ? " (current)" : ""}`}
      className={cn(
        "relative grid h-8 place-items-center rounded-lg border text-xs font-bold tabular-nums transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
        STYLE[status].cell,
        current && "ring-2 ring-brand ring-offset-2",
      )}
    >
      {number}
      {/* Shape cues, so state never depends on colour alone. */}
      {answered && (
        <Check
          className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full bg-white p-px text-brand-strong"
          strokeWidth={4}
          aria-hidden
        />
      )}
      {marked && (
        <Bookmark
          className="absolute -right-1 -top-1 h-3 w-3 rounded-sm bg-white p-px text-amber-600"
          strokeWidth={3}
          aria-hidden
        />
      )}
    </button>
  );
}

interface QuestionNavigatorProps {
  paper: ExamPaperResponse;
  answers: Record<string, AnswerState>;
  currentIndex: number;
  onSelect: (index: number) => void;
}

export function QuestionNavigator({
  paper,
  answers,
  currentIndex,
  onSelect,
}: QuestionNavigatorProps) {
  const [open, setOpen] = useState(false);
  const counts = summarize(paper.questions.map((q) => answers[q.id]));
  const status = (id: string) => questionStatus(answers[id]);

  return (
    <section
      aria-labelledby="navigator-heading"
      className="flex min-h-[250px] flex-1 flex-col rounded-2xl border border-slate-200/70 bg-white p-3.5 shadow-sm"
    >
      <h2 id="navigator-heading" className="text-sm font-bold text-navy">
        Question Navigator
      </h2>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1" aria-label="Legend">
        {LEGEND_ORDER.map((s) => (
          <li key={s} className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600">
            <span className={cn("h-2.5 w-2.5 rounded-full", STYLE[s].dot)} aria-hidden />
            {QUESTION_STATUS_LABEL[s]}
          </li>
        ))}
      </ul>
      <div className="mt-2.5 min-h-0 flex-1 overflow-y-auto p-1">
        <div className="grid grid-cols-10 gap-1.5">
          {paper.questions.map((q, i) => (
            <Cell
              key={q.id}
              number={q.number}
              status={status(q.id)}
              current={i === currentIndex}
              onSelect={() => onSelect(i)}
            />
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2.5 h-9 rounded-xl border border-slate-200 text-xs font-bold text-brand-strong transition-colors hover:bg-brand-soft/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        View All Questions
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="kp max-w-2xl rounded-2xl bg-white p-5">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-navy">All questions</DialogTitle>
            <DialogDescription className="text-xs text-slate-600">
              {counts.answered + counts.answered_marked} answered ·{" "}
              {counts.marked + counts.answered_marked} marked for review · {counts.not_visited} not
              visited
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
            {(paper.sections.length
              ? paper.sections.map((s) => ({
                  id: s.id,
                  title: s.title,
                  items: paper.questions.filter((q) => q.sectionId === s.id),
                }))
              : [{ id: "all", title: "Questions", items: paper.questions }]
            ).map((group) => (
              <div key={group.id}>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  {group.title}
                </h3>
                <div className="mt-2 grid grid-cols-10 gap-1.5 p-1">
                  {group.items.map((q) => {
                    const index = paper.questions.indexOf(q);
                    return (
                      <Cell
                        key={q.id}
                        number={q.number}
                        status={status(q.id)}
                        current={index === currentIndex}
                        onSelect={() => {
                          setOpen(false);
                          onSelect(index);
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

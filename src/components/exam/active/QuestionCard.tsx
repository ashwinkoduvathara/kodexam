import { AlertCircle, ArrowRight, Check, CircleCheck, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { optionLetter } from "@/lib/exam/paper/question-state";
import { SUPPORTED_QUESTION_TYPES, type AnswerState, type PaperQuestion } from "@/types/paper";
import { cn } from "@/lib/utils";

export type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | { kind: "failed"; message: string };

interface QuestionCardProps {
  question: PaperQuestion;
  saved: AnswerState;
  /** The current, possibly unsaved, selection. */
  selection: string | null;
  dirty: boolean;
  saveStatus: SaveStatus;
  locked: boolean;
  isLast: boolean;
  onSelect: (optionId: string) => void;
  onClear: () => void;
  onSave: () => void;
}

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Single-choice question. Other types render an honest "not supported" notice. */
export function QuestionCard({
  question,
  saved,
  selection,
  dirty,
  saveStatus,
  locked,
  isLast,
  onSelect,
  onClear,
  onSave,
}: QuestionCardProps) {
  const supported = (SUPPORTED_QUESTION_TYPES as readonly string[]).includes(question.type);
  const saving = saveStatus.kind === "saving";
  const clearingSaved = dirty && selection === null && saved.selectedOptionId !== null;
  const savedLetter =
    saved.selectedOptionId !== null
      ? optionLetter(question.options.findIndex((o) => o.id === saved.selectedOptionId))
      : null;
  const saveLabel = isLast
    ? "Save Answer"
    : dirty
      ? clearingSaved
        ? "Clear & Next"
        : "Save & Next"
      : "Next";

  return (
    <section
      aria-labelledby="question-heading"
      className="flex min-h-0 flex-1 flex-col rounded-2xl border border-slate-200/70 bg-white shadow-sm"
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-7 pt-6 pb-4 short:pt-4 short:pb-3">
        <h2
          id="question-heading"
          className="flex gap-3 text-[19px] font-bold leading-snug text-navy"
        >
          <span className="shrink-0 font-semibold text-slate-500">{question.number}.</span>
          <span>{question.prompt}</span>
        </h2>
        <p className="mt-1.5 pl-9 text-xs font-medium text-slate-500">
          {question.marks} {question.marks === 1 ? "mark" : "marks"} · Choose one answer
        </p>

        {supported ? (
          <div
            role="radiogroup"
            aria-labelledby="question-heading"
            className="mt-4 flex flex-col gap-3 short:mt-3 short:gap-2"
          >
            {question.options.map((option, i) => {
              const selected = selection === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-option={optionLetter(i)}
                  disabled={locked}
                  // Enter/Space select; arrow keys do nothing, so moving focus never changes an answer.
                  onClick={() => onSelect(option.id)}
                  className={cn(
                    "flex w-full items-center gap-4 rounded-xl border px-4 py-3 text-left transition-colors short:py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 disabled:cursor-not-allowed",
                    selected
                      ? "border-brand/60 bg-brand-soft/60"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                  )}
                >
                  <span
                    className={cn(
                      "grid h-10 w-10 shrink-0 place-items-center rounded-full border text-[15px] font-bold short:h-8 short:w-8 short:text-sm",
                      selected
                        ? "border-brand bg-brand text-white"
                        : "border-slate-200 bg-slate-50 text-navy",
                    )}
                  >
                    {optionLetter(i)}
                  </span>
                  <span className="flex-1 text-[15px] text-slate-700">{option.text}</span>
                  {selected && (
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand text-white">
                      <Check className="h-4 w-4" strokeWidth={3} aria-hidden />
                      <span className="sr-only">Selected</span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <p
            role="status"
            className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            This question type isn't supported by this version of KProctor yet. Please contact
            support.
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-4 border-t border-slate-100 px-7 py-4 short:py-3">
        <Button
          variant="outline"
          onClick={onClear}
          disabled={locked || saving || selection === null}
          className="h-11 rounded-xl border-slate-200 px-5 text-sm font-bold text-navy shadow-sm"
        >
          <RotateCcw aria-hidden />
          Clear Selection
        </Button>

        <div className="flex min-w-0 items-center gap-4">
          <p
            aria-live="polite"
            className="min-w-0 text-right text-xs font-semibold"
            data-save-status={
              saveStatus.kind === "idle" ? (dirty ? "unsaved" : "idle") : saveStatus.kind
            }
          >
            {saveStatus.kind === "saving" ? (
              <span className="text-slate-500">Saving…</span>
            ) : saveStatus.kind === "failed" ? (
              <span className="flex items-center gap-1.5 text-red-700">
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
                {saveStatus.message}
              </span>
            ) : dirty ? (
              <span className="text-amber-700">
                {clearingSaved
                  ? `Your saved answer (${savedLetter}) will be removed when you save.`
                  : "Not saved yet"}
              </span>
            ) : saveStatus.kind === "saved" ? (
              <span className="flex items-center gap-1.5 text-brand-strong">
                <CircleCheck className="h-4 w-4" aria-hidden />
                Saved at {time(saveStatus.at)}
              </span>
            ) : saved.savedAt && saved.selectedOptionId ? (
              <span className="text-slate-500">Answer saved</span>
            ) : null}
          </p>
          <Button
            onClick={onSave}
            disabled={locked || saving || (isLast && !dirty)}
            className="h-11 min-w-[170px] rounded-xl px-6 text-sm font-bold shadow-[0_8px_20px_-10px] shadow-brand/60"
          >
            {saving && <Loader2 className="animate-spin" aria-hidden />}
            {saveStatus.kind === "failed" ? "Retry Save" : saveLabel}
            {!saving && !isLast && <ArrowRight aria-hidden />}
          </Button>
        </div>
      </div>
    </section>
  );
}

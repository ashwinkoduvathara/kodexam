import { Bookmark, ChevronDown, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ExamPaperResponse } from "@/types/paper";
import { cn } from "@/lib/utils";

interface QuestionToolbarProps {
  sections: ExamPaperResponse["sections"];
  currentSectionId: string | null;
  questionNumber: number;
  questionCount: number;
  marked: boolean;
  markPending: boolean;
  disabled: boolean;
  onSectionChange: (sectionId: string) => void;
  onToggleMark: () => void;
}

export function QuestionToolbar({
  sections,
  currentSectionId,
  questionNumber,
  questionCount,
  marked,
  markPending,
  disabled,
  onSectionChange,
  onToggleMark,
}: QuestionToolbarProps) {
  const current = sections.find((s) => s.id === currentSectionId);
  return (
    <div className="flex h-14 shrink-0 items-center justify-between gap-4 rounded-2xl border border-slate-200/70 bg-white px-5 shadow-sm">
      <div className="flex items-center gap-2 text-sm">
        {sections.length > 0 && (
          <>
            <span className="text-slate-500">Section:</span>
            <DropdownMenu>
              <DropdownMenuTrigger
                disabled={disabled}
                className="flex items-center gap-1 rounded-lg px-1.5 py-1 font-bold text-brand-strong outline-none hover:bg-brand-soft/60 focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-50"
              >
                {current?.title ?? "All"}
                <ChevronDown className="h-4 w-4" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="kp min-w-48">
                <DropdownMenuRadioGroup
                  value={currentSectionId ?? ""}
                  onValueChange={(v) => onSectionChange(v)}
                >
                  {sections.map((s) => (
                    <DropdownMenuRadioItem key={s.id} value={s.id} className="text-sm">
                      {s.title}
                      <span className="ml-auto pl-3 text-xs text-slate-500">
                        {s.questionCount} questions
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>

      <div className="flex items-center gap-6">
        <p className="text-sm text-slate-600" aria-live="polite">
          Question <span className="font-bold text-navy">{questionNumber}</span> of {questionCount}
        </p>
        <div className="flex items-center gap-2.5">
          <Bookmark
            className={cn("h-4.5 w-4.5", marked ? "fill-amber-400 text-amber-500" : "text-navy")}
            aria-hidden
          />
          <span id="mark-review-label" className="text-sm font-semibold text-navy">
            Mark for Review
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={marked}
            aria-labelledby="mark-review-label"
            aria-busy={markPending}
            disabled={disabled || markPending}
            onClick={onToggleMark}
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-2 disabled:opacity-60",
              marked ? "border-amber-500 bg-amber-400" : "border-slate-200 bg-slate-200",
            )}
          >
            <span
              className={cn(
                "grid h-5 w-5 place-items-center rounded-full bg-white shadow transition-transform",
                marked ? "translate-x-5" : "translate-x-0.5",
              )}
            >
              {markPending && (
                <Loader2 className="h-3 w-3 animate-spin text-slate-500" aria-hidden />
              )}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

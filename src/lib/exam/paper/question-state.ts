import type { AnswerState } from "@/types/paper";

/** Navigator state, derived only from the server's persisted answer state. */
export type QuestionStatus =
  "not_visited" | "not_answered" | "answered" | "marked" | "answered_marked";

export function questionStatus(answer: AnswerState | undefined): QuestionStatus {
  if (!answer) return "not_visited";
  const answered = answer.selectedOptionId !== null;
  if (answer.markedForReview) return answered ? "answered_marked" : "marked";
  if (answered) return "answered";
  return answer.visited ? "not_answered" : "not_visited";
}

export const QUESTION_STATUS_LABEL: Record<QuestionStatus, string> = {
  not_visited: "Not Visited",
  not_answered: "Not Answered",
  answered: "Answered",
  marked: "Marked for Review",
  answered_marked: "Answered & Marked",
};

export function summarize(answers: AnswerState[]): Record<QuestionStatus, number> {
  const counts: Record<QuestionStatus, number> = {
    not_visited: 0,
    not_answered: 0,
    answered: 0,
    marked: 0,
    answered_marked: 0,
  };
  for (const a of answers) counts[questionStatus(a)] += 1;
  return counts;
}

/** Option letters: A, B, … Z, then AA, AB… (never needed in practice, but never wrong). */
export function optionLetter(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

import { describe, expect, it } from "vitest";
import type { AnswerState } from "@/types/paper";
import { optionLetter, questionStatus, summarize } from "./question-state";

const base: AnswerState = {
  questionId: "q",
  selectedOptionId: null,
  markedForReview: false,
  visited: false,
  answerVersion: 0,
  savedAt: null,
};

describe("questionStatus", () => {
  it("derives every navigator state from persisted answer state", () => {
    expect(questionStatus(undefined)).toBe("not_visited");
    expect(questionStatus(base)).toBe("not_visited");
    expect(questionStatus({ ...base, visited: true })).toBe("not_answered");
    expect(questionStatus({ ...base, visited: true, selectedOptionId: "a" })).toBe("answered");
    expect(questionStatus({ ...base, markedForReview: true })).toBe("marked");
    expect(questionStatus({ ...base, markedForReview: true, selectedOptionId: "a" })).toBe(
      "answered_marked",
    );
  });

  it("summarizes counts", () => {
    const counts = summarize([
      base,
      { ...base, visited: true, selectedOptionId: "a" },
      { ...base, markedForReview: true },
    ]);
    expect(counts).toMatchObject({ not_visited: 1, answered: 1, marked: 1 });
  });

  it("letters options", () => {
    expect([0, 1, 2, 3, 25, 26].map(optionLetter)).toEqual(["A", "B", "C", "D", "Z", "AA"]);
  });
});

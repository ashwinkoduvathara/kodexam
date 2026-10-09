import { describe, expect, it } from "vitest";
import { formatDuration, getTimerTone, secondsUntil } from "./time";

describe("secondsUntil", () => {
  it("derives remaining time from the server end time", () => {
    expect(secondsUntil(10_000, 0)).toBe(10);
    expect(secondsUntil(10_500, 0)).toBe(11);
  });

  it("never goes negative", () => {
    expect(secondsUntil(1_000, 5_000)).toBe(0);
  });
});

describe("getTimerTone", () => {
  it("is normal above 10 minutes", () => expect(getTimerTone(601)).toBe("normal"));
  it("turns amber at 10 minutes", () => expect(getTimerTone(600)).toBe("warning"));
  it("turns red at 5 minutes", () => expect(getTimerTone(300)).toBe("critical"));
  it("is expired at zero", () => expect(getTimerTone(0)).toBe("expired"));
});

describe("formatDuration", () => {
  it("formats hh:mm:ss", () => {
    expect(formatDuration(5325)).toBe("01:28:45");
    expect(formatDuration(-5)).toBe("00:00:00");
  });
});

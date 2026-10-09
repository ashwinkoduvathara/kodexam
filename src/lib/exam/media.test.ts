import { describe, expect, it } from "vitest";
import { describeMediaError } from "./media";

const err = (name: string) => new DOMException("raw browser message", name);

describe("describeMediaError", () => {
  it("maps NotAllowedError to Permission Required with actionable copy", () => {
    const state = describeMediaError(err("NotAllowedError"), "camera");
    expect(state).toMatchObject({ status: "failed", reason: "permission_required" });
    expect(state.message?.title).toBe("Camera access is blocked.");
    expect(state.message?.description).toBe(
      "Allow camera access from your browser settings and try again.",
    );
  });

  it("explains a dismissed prompt differently from a block", () => {
    expect(describeMediaError(err("NotAllowedError"), "microphone", "prompt").reason).toBe(
      "permission_prompt",
    );
  });

  it("maps NotFoundError to no device", () => {
    const state = describeMediaError(err("NotFoundError"), "microphone");
    expect(state).toMatchObject({ status: "not_available", reason: "no_device" });
    expect(state.label).toBe("No Microphone");
  });

  it("maps NotReadableError to device in use", () => {
    const state = describeMediaError(err("NotReadableError"), "camera");
    expect(state.reason).toBe("device_error");
    expect(state.message?.title).toBe("The camera is currently being used by another application.");
  });

  it("maps SecurityError to unavailable environment", () => {
    expect(describeMediaError(err("SecurityError"), "camera").message?.title).toBe(
      "Camera access is unavailable in this browser environment.",
    );
  });

  it("never leaks raw browser messages", () => {
    for (const name of ["NotAllowedError", "NotFoundError", "AbortError", "WeirdError"]) {
      const state = describeMediaError(err(name), "camera");
      expect(JSON.stringify(state)).not.toContain("raw browser message");
    }
  });
});

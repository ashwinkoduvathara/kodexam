import { describe, expect, it } from "vitest";
import type { ProctoringPolicy, SecurityPolicy } from "@/types/exam";
import { ATTEMPT_STATUS } from "@/types/exam-attempt";
import { describeProctoringPolicy, getFlaggedActivities } from "./policy";
import { completedStepsFrom, routeForStatus } from "./steps";

const strict: ProctoringPolicy = {
  cameraRequired: true,
  microphoneRequired: true,
  screenMonitoringRequired: true,
  fullscreenRequired: true,
  identityVerificationRequired: true,
};
const relaxed: ProctoringPolicy = {
  cameraRequired: false,
  microphoneRequired: true,
  screenMonitoringRequired: false,
  fullscreenRequired: false,
  identityVerificationRequired: false,
};
const security: SecurityPolicy = {
  allowTabSwitch: false,
  allowExternalDevices: false,
  allowBackNavigation: false,
  allowPause: false,
  autoSubmitOnExpiry: true,
};

describe("describeProctoringPolicy", () => {
  it("reflects each exam's configuration", () => {
    expect(describeProctoringPolicy(strict).map((i) => i.state)).toEqual([
      "Required",
      "Required",
      "Enabled",
      "Required",
    ]);
    expect(describeProctoringPolicy(relaxed).map((i) => i.state)).toEqual([
      "Not Required",
      "Required",
      "Disabled",
      "Not Required",
    ]);
  });
});

describe("getFlaggedActivities", () => {
  it("lists all eight activities for a strict exam", () => {
    expect(getFlaggedActivities(strict, security)).toHaveLength(8);
  });

  it("omits activities the exam doesn't monitor", () => {
    const labels = getFlaggedActivities(relaxed, { ...security, allowTabSwitch: true }).map(
      (a) => a.label,
    );
    expect(labels).not.toContain("Leaving fullscreen");
    expect(labels).not.toContain("Camera disconnected");
    expect(labels).not.toContain("Tab switching");
    expect(labels).toContain("Receiving external assistance");
  });

  it("never uses accusatory wording", () => {
    const text = getFlaggedActivities(strict, security)
      .map((a) => a.label)
      .join(" ")
      .toLowerCase();
    expect(text).not.toMatch(/cheat/);
  });
});

describe("step routing", () => {
  it("sends candidates to the step the server says they're on", () => {
    expect(routeForStatus(ATTEMPT_STATUS.SYSTEM_CHECK)).toBe("/exam/$examId/system-check");
    expect(routeForStatus(ATTEMPT_STATUS.INSTRUCTIONS)).toBe("/exam/$examId/instructions");
    expect(routeForStatus(ATTEMPT_STATUS.IDENTITY_VERIFICATION)).toBe(
      "/exam/$examId/identity-verification",
    );
    expect(routeForStatus(ATTEMPT_STATUS.READY)).toBe("/exam/$examId/start");
    expect(routeForStatus(ATTEMPT_STATUS.IN_PROGRESS)).toBe("/exam/$examId/active");
  });

  it("derives completed steps from server timestamps", () => {
    expect(
      completedStepsFrom({ systemCheckCompletedAt: "x", instructionsAcknowledgedAt: null }),
    ).toEqual(["system-check"]);
  });
});

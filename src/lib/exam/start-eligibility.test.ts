import { describe, expect, it } from "vitest";
import type { ProctoringPolicy } from "@/types/exam";
import { ATTEMPT_STATUS, IDENTITY_STATUS } from "@/types/exam-attempt";
import { getStartEligibility } from "./start-eligibility";

const policy: ProctoringPolicy = {
  cameraRequired: true,
  microphoneRequired: true,
  screenMonitoringRequired: true,
  fullscreenRequired: true,
  identityVerificationRequired: true,
  identityReviewPolicy: "BLOCK",
};

const ready = {
  attemptStatus: ATTEMPT_STATUS.READY,
  systemCheckCompletedAt: "2026-10-09T10:00:00.000Z",
  instructionsAcknowledgedAt: "2026-10-09T10:02:00.000Z",
  identityVerificationStatus: IDENTITY_STATUS.VERIFIED,
  proctoringPolicy: policy,
} as const;

describe("getStartEligibility", () => {
  it("allows starting when every pre-exam step is complete", () => {
    expect(getStartEligibility(ready, false)).toEqual({
      canStart: true,
      identityUnderReview: false,
      reason: null,
    });
  });

  it("blocks invalid attempt states", () => {
    for (const status of [
      ATTEMPT_STATUS.SYSTEM_CHECK,
      ATTEMPT_STATUS.INSTRUCTIONS,
      ATTEMPT_STATUS.IDENTITY_VERIFICATION,
      ATTEMPT_STATUS.IN_PROGRESS,
      ATTEMPT_STATUS.CANCELLED,
      ATTEMPT_STATUS.EXPIRED,
    ]) {
      expect(getStartEligibility({ ...ready, attemptStatus: status }, false).canStart).toBe(false);
    }
  });

  it("blocks an expired session", () => {
    const result = getStartEligibility(ready, true);
    expect(result.canStart).toBe(false);
    expect(result.reason).toMatch(/expired/i);
  });

  it("blocks when a recorded step is missing, even at READY", () => {
    expect(getStartEligibility({ ...ready, systemCheckCompletedAt: null }, false).canStart).toBe(
      false,
    );
    expect(
      getStartEligibility({ ...ready, instructionsAcknowledgedAt: null }, false).canStart,
    ).toBe(false);
  });

  it("blocks pending identity review when the policy is BLOCK", () => {
    const result = getStartEligibility(
      { ...ready, identityVerificationStatus: IDENTITY_STATUS.REVIEW_REQUIRED },
      false,
    );
    expect(result.canStart).toBe(false);
  });

  it("allows pending review only when the policy explicitly permits it", () => {
    const result = getStartEligibility(
      {
        ...ready,
        identityVerificationStatus: IDENTITY_STATUS.REVIEW_REQUIRED,
        proctoringPolicy: { ...policy, identityReviewPolicy: "ALLOW_PENDING_REVIEW" },
      },
      false,
    );
    expect(result).toMatchObject({ canStart: true, identityUnderReview: true });
  });

  it("blocks failed or pending identity verification", () => {
    for (const status of [IDENTITY_STATUS.FAILED, IDENTITY_STATUS.PENDING]) {
      expect(
        getStartEligibility({ ...ready, identityVerificationStatus: status }, false).canStart,
      ).toBe(false);
    }
  });

  it("treats NOT_REQUIRED as complete only when the exam doesn't require identity", () => {
    const notRequired = { ...ready, identityVerificationStatus: IDENTITY_STATUS.NOT_REQUIRED };
    expect(getStartEligibility(notRequired, false).canStart).toBe(false);
    expect(
      getStartEligibility(
        { ...notRequired, proctoringPolicy: { ...policy, identityVerificationRequired: false } },
        false,
      ).canStart,
    ).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { areRequiredChecksPassed, validateSystemReadiness } from "./readiness";
import type { ReadinessProbe, SystemCheckId, SystemCheckStates } from "./types";

const ALL: SystemCheckId[] = ["camera", "microphone", "speaker", "network"];
const passedStates = (): SystemCheckStates => ({
  camera: { status: "passed" },
  microphone: { status: "passed" },
  speaker: { status: "passed" },
  network: { status: "passed" },
});
const ok: ReadinessProbe = () => ({ ok: true });
const okProbes = () => ({ camera: ok, microphone: ok, speaker: ok, network: ok });

describe("areRequiredChecksPassed", () => {
  it("requires every required check", () => {
    const states = passedStates();
    expect(areRequiredChecksPassed(ALL, states)).toBe(true);
    states.network = { status: "failed", reason: "connection_lost" };
    expect(areRequiredChecksPassed(ALL, states)).toBe(false);
  });

  it("ignores checks that aren't required", () => {
    const states = passedStates();
    states.speaker = { status: "idle" };
    expect(areRequiredChecksPassed(["camera", "network"], states)).toBe(true);
  });
});

describe("validateSystemReadiness", () => {
  it("passes when states and live probes agree", async () => {
    const result = await validateSystemReadiness({
      requiredChecks: ALL,
      states: passedStates(),
      probes: okProbes(),
      sessionExpired: false,
    });
    expect(result.ok).toBe(true);
  });

  it("does not trust React state when the live probe fails", async () => {
    const result = await validateSystemReadiness({
      requiredChecks: ALL,
      states: passedStates(),
      probes: {
        ...okProbes(),
        camera: () => ({ ok: false, reason: "Camera stream is not active." }),
      },
      sessionExpired: false,
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([{ check: "camera", reason: "Camera stream is not active." }]);
  });

  it("fails when a probe is missing or throws", async () => {
    const { microphone: _, ...rest } = okProbes();
    const result = await validateSystemReadiness({
      requiredChecks: ALL,
      states: passedStates(),
      probes: {
        ...rest,
        network: async () => {
          throw new Error("boom");
        },
      },
      sessionExpired: false,
    });
    expect(result.failures.map((f) => f.check).sort()).toEqual(["microphone", "network"]);
  });

  it("fails when the session has expired", async () => {
    const result = await validateSystemReadiness({
      requiredChecks: ALL,
      states: passedStates(),
      probes: okProbes(),
      sessionExpired: true,
    });
    expect(result.ok).toBe(false);
  });
});

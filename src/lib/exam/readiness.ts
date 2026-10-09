import {
  isCheckSatisfied,
  type ReadinessProbe,
  type SystemCheckId,
  type SystemCheckStates,
} from "./types";

export interface ReadinessFailure {
  check: SystemCheckId | "session";
  reason: string;
}

export interface ReadinessResult {
  ok: boolean;
  failures: ReadinessFailure[];
  checkedAt: number;
}

interface ValidateOptions {
  requiredChecks: SystemCheckId[];
  states: SystemCheckStates;
  probes: Partial<Record<SystemCheckId, ReadinessProbe>>;
  sessionExpired: boolean;
}

const LABEL: Record<SystemCheckId, string> = {
  camera: "Camera",
  microphone: "Microphone",
  speaker: "Speaker",
  network: "Internet connection",
};

/** Derived readiness from reported states only. Drives the Continue button. */
export function areRequiredChecksPassed(
  requiredChecks: SystemCheckId[],
  states: SystemCheckStates,
): boolean {
  return requiredChecks.every((id) => isCheckSatisfied(states[id].status));
}

/**
 * Final authority before the candidate may proceed.
 *
 * Re-verifies the *actual* resources through each check's probe (live video
 * track producing frames, running microphone analysis, confirmed speaker,
 * reachable exam server) rather than trusting reported React state.
 */
export async function validateSystemReadiness({
  requiredChecks,
  states,
  probes,
  sessionExpired,
}: ValidateOptions): Promise<ReadinessResult> {
  const failures: ReadinessFailure[] = [];

  if (sessionExpired) failures.push({ check: "session", reason: "Exam session has expired." });

  const results = await Promise.all(
    requiredChecks.map(async (id): Promise<ReadinessFailure | null> => {
      if (!isCheckSatisfied(states[id].status)) {
        return { check: id, reason: `${LABEL[id]} check hasn't passed.` };
      }
      const probe = probes[id];
      if (!probe) return { check: id, reason: `${LABEL[id]} is not active.` };
      try {
        const result = await probe();
        return result.ok ? null : { check: id, reason: result.reason };
      } catch {
        return { check: id, reason: `${LABEL[id]} couldn't be verified.` };
      }
    }),
  );
  for (const r of results) if (r) failures.push(r);

  return { ok: failures.length === 0, failures, checkedAt: Date.now() };
}

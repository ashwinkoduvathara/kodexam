import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { CHECK_TIMING } from "@/lib/exam/config";
import {
  areRequiredChecksPassed,
  validateSystemReadiness,
  type ReadinessResult,
} from "@/lib/exam/readiness";
import { useLatest } from "./use-latest";
import type {
  CheckState,
  ReadinessProbe,
  SystemCheckId,
  SystemCheckStates,
} from "@/lib/exam/types";

const INITIAL_STATES: SystemCheckStates = {
  camera: { status: "checking" },
  microphone: { status: "checking" },
  speaker: { status: "idle" },
  network: { status: "checking" },
};

type Action = { id: SystemCheckId; state: CheckState };

function reducer(states: SystemCheckStates, { id, state }: Action): SystemCheckStates {
  return states[id] === state ? states : { ...states, [id]: state };
}

export interface CheckReporter {
  report: (id: SystemCheckId, state: CheckState) => void;
  registerProbe: (id: SystemCheckId, probe: ReadinessProbe | null) => void;
}

/**
 * Central readiness store for the System Check.
 *
 * - `states`: one entry per check, reported by each check component
 * - `allRequiredChecksPassed`: the single derived readiness value
 * - `canContinue`: readiness confirmed by `validateSystemReadiness()` probing
 *    the real devices; re-validated periodically while enabled
 */
export function useSystemReadiness({
  requiredChecks,
  sessionExpired,
}: {
  requiredChecks: SystemCheckId[];
  sessionExpired: boolean;
}) {
  const [states, dispatch] = useReducer(reducer, INITIAL_STATES);
  const probesRef = useRef<Partial<Record<SystemCheckId, ReadinessProbe>>>({});
  const statesRef = useLatest(states);
  const seqRef = useRef(0);
  const [validation, setValidation] = useState<ReadinessResult | null>(null);

  const reporter = useMemo<CheckReporter>(
    () => ({
      report: (id, state) => dispatch({ id, state }),
      registerProbe: (id, probe) => {
        if (probe) probesRef.current[id] = probe;
        else delete probesRef.current[id];
      },
    }),
    [],
  );

  const allRequiredChecksPassed =
    !sessionExpired && areRequiredChecksPassed(requiredChecks, states);

  const validate = useCallback(async () => {
    const seq = ++seqRef.current;
    const result = await validateSystemReadiness({
      requiredChecks,
      states: statesRef.current,
      probes: probesRef.current,
      sessionExpired,
    });
    if (seq === seqRef.current) setValidation(result);
    return result;
  }, [requiredChecks, sessionExpired, statesRef]);

  useEffect(() => {
    if (!allRequiredChecksPassed) {
      seqRef.current++;
      setValidation(null);
      return;
    }
    void validate();
    const id = window.setInterval(validate, CHECK_TIMING.readinessRevalidateInterval);
    return () => window.clearInterval(id);
  }, [allRequiredChecksPassed, validate]);

  const canContinue = allRequiredChecksPassed && validation?.ok === true;

  return { states, reporter, allRequiredChecksPassed, canContinue, validation, validate };
}

/** Wires a check component's state and live probe into the readiness store. */
export function useCheckReporting(
  reporter: CheckReporter,
  id: SystemCheckId,
  state: CheckState,
  probe: ReadinessProbe,
) {
  useEffect(() => reporter.report(id, state), [reporter, id, state]);
  useEffect(() => {
    reporter.registerProbe(id, probe);
    return () => reporter.registerProbe(id, null);
  }, [reporter, id, probe]);
}

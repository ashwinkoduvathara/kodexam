import type { ProctoringEventType } from "./paper";

/**
 * What the server does about proctoring events. Configured per exam
 * (`proctoringPolicy.eventPolicy`, frozen into the attempt's session snapshot);
 * DEFAULT_EVENT_POLICY applies otherwise.
 *
 * Escalation for one event type, by how many times it has occurred in the attempt:
 *   RECORD    always: the event is stored and audited
 *   WARN      a neutral reminder is shown to the candidate
 *   REVIEW    the attempt is flagged for a human reviewer (never shown as an accusation)
 *   TERMINATE the exam is ended and submitted. Only for events from a TRUSTED
 *             source and only when `allowAutomaticTermination` is true; otherwise
 *             it escalates to REVIEW with "termination recommended".
 */
export type EnforcementAction = "RECORD" | "WARN" | "REVIEW" | "TERMINATE";

/** Browser-reported events are untrusted: the candidate controls the browser. */
export type EventSource = "BROWSER" | "DETECTION_SERVICE";
export const SOURCE_TRUST: Record<EventSource, "UNTRUSTED" | "TRUSTED"> = {
  BROWSER: "UNTRUSTED",
  DETECTION_SERVICE: "TRUSTED",
};

export interface EventRule {
  warnAt?: number;
  reviewAt?: number;
  terminateAt?: number;
}

export interface EventPolicyConfig {
  rules: Partial<Record<ProctoringEventType, EventRule>>;
  /** Off by default. Even when on, applies only to TRUSTED sources. */
  allowAutomaticTermination: boolean;
}

export const DEFAULT_EVENT_POLICY: EventPolicyConfig = {
  rules: {
    CAMERA_DISCONNECTED: { warnAt: 1, reviewAt: 3 },
    MICROPHONE_DISCONNECTED: { warnAt: 1, reviewAt: 3 },
    FULLSCREEN_EXITED: { warnAt: 1, reviewAt: 3 },
    TAB_HIDDEN: { warnAt: 1, reviewAt: 3 },
  },
  allowAutomaticTermination: false,
};

/** Neutral, instructional wording — what to do, never what the candidate "did". */
export const CANDIDATE_NOTICES: Partial<Record<ProctoringEventType, string>> = {
  CAMERA_DISCONNECTED: "Your camera isn't sending video. Please reconnect it to continue.",
  MICROPHONE_DISCONNECTED: "Your microphone stopped working. Please reconnect it to continue.",
  FULLSCREEN_EXITED: "This exam runs in fullscreen. Please return to fullscreen.",
  TAB_HIDDEN: "Please keep the exam window open and in front while the exam is in progress.",
};

export interface EnforcementDecision {
  action: EnforcementAction;
  /** The rule asked for termination but the source/policy didn't allow it automatically. */
  terminationRecommended: boolean;
  count: number;
}

const valid = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1;

/** Server-side decision. Pure, so it is easy to test and audit. */
export function evaluateEvent(input: {
  type: ProctoringEventType;
  source: EventSource;
  /** Occurrences of this type in the attempt, including this one. */
  count: number;
  policy: EventPolicyConfig;
}): EnforcementDecision {
  const rule = input.policy.rules[input.type] ?? {};
  const base = { count: input.count, terminationRecommended: false };
  if (valid(rule.terminateAt) && input.count >= rule.terminateAt) {
    const trusted = SOURCE_TRUST[input.source] === "TRUSTED";
    if (trusted && input.policy.allowAutomaticTermination === true) {
      return { ...base, action: "TERMINATE" };
    }
    return { ...base, action: "REVIEW", terminationRecommended: true };
  }
  if (valid(rule.reviewAt) && input.count >= rule.reviewAt) return { ...base, action: "REVIEW" };
  if (valid(rule.warnAt) && input.count >= rule.warnAt) return { ...base, action: "WARN" };
  return { ...base, action: "RECORD" };
}

/** Sanitises a stored policy; anything malformed falls back to the default. */
export function resolveEventPolicy(raw: unknown): EventPolicyConfig {
  if (!raw || typeof raw !== "object") return DEFAULT_EVENT_POLICY;
  const r = raw as Partial<EventPolicyConfig>;
  if (!r.rules || typeof r.rules !== "object") return DEFAULT_EVENT_POLICY;
  return { rules: r.rules, allowAutomaticTermination: r.allowAutomaticTermination === true };
}

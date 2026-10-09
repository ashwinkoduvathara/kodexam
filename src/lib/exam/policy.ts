import type { ProctoringPolicy, SecurityPolicy } from "@/types/exam";

export type PolicyState = "Required" | "Enabled" | "Not Required" | "Disabled";

export interface PolicyItem {
  id: "camera" | "microphone" | "screen" | "fullscreen";
  label: string;
  state: PolicyState;
  active: boolean;
}

/** How each proctoring requirement is presented to the candidate. Driven by the exam's policy. */
export function describeProctoringPolicy(policy: ProctoringPolicy): PolicyItem[] {
  const required = (on: boolean): PolicyState => (on ? "Required" : "Not Required");
  return [
    {
      id: "camera",
      label: "Camera",
      state: required(policy.cameraRequired),
      active: policy.cameraRequired,
    },
    {
      id: "microphone",
      label: "Microphone",
      state: required(policy.microphoneRequired),
      active: policy.microphoneRequired,
    },
    {
      id: "screen",
      label: "Screen Monitoring",
      state: policy.screenMonitoringRequired ? "Enabled" : "Disabled",
      active: policy.screenMonitoringRequired,
    },
    {
      id: "fullscreen",
      label: "Fullscreen",
      state: required(policy.fullscreenRequired),
      active: policy.fullscreenRequired,
    },
  ];
}

export interface FlaggedActivity {
  id: string;
  label: string;
}

/**
 * Activities that may be flagged for review, filtered to what this exam's
 * policies actually monitor (e.g. no "Leaving fullscreen" if fullscreen isn't required).
 */
export function getFlaggedActivities(
  proctoring: ProctoringPolicy,
  security: SecurityPolicy,
): FlaggedActivity[] {
  const all: (FlaggedActivity & { applies: boolean })[] = [
    { id: "tab-switching", label: "Tab switching", applies: !security.allowTabSwitch },
    {
      id: "leaving-fullscreen",
      label: "Leaving fullscreen",
      applies: proctoring.fullscreenRequired,
    },
    {
      id: "multiple-people",
      label: "Multiple people in camera view",
      applies: proctoring.cameraRequired,
    },
    {
      id: "camera-disconnected",
      label: "Camera disconnected",
      applies: proctoring.cameraRequired,
    },
    {
      id: "unauthorized-devices",
      label: "Unauthorized devices",
      applies: !security.allowExternalDevices,
    },
    { id: "screen-sharing", label: "Screen sharing", applies: proctoring.screenMonitoringRequired },
    { id: "leaving-environment", label: "Leaving the examination environment", applies: true },
    { id: "external-assistance", label: "Receiving external assistance", applies: true },
  ];
  return all.filter((a) => a.applies).map(({ id, label }) => ({ id, label }));
}

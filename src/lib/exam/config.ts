/**
 * KProctor runtime configuration. Values can be overridden per deployment with
 * VITE_* environment variables; defaults match the public Kodeversity contacts.
 */

const env = import.meta.env;

export interface SupportConfig {
  email: string;
  phone: string;
  hours: string;
}

export const SUPPORT_CONFIG: SupportConfig = {
  email: env.VITE_SUPPORT_EMAIL ?? "info@kodeversity.com",
  phone: env.VITE_SUPPORT_PHONE ?? "+91 8086 9090 55",
  hours: env.VITE_SUPPORT_HOURS ?? "Monday to Saturday, 9:00 AM – 6:00 PM IST",
};

/** Timings for the device checks (ms). */
export const CHECK_TIMING = {
  /** Camera must deliver a first frame within this window. */
  cameraFrameTimeout: 10_000,
  /** A live camera that stops producing frames for this long is treated as failed. */
  cameraStallTimeout: 4_000,
  /** Microphone delivering digital silence for this long is reported as "no input". */
  microphoneNoInputAfter: 6_000,
  /** Interval for re-validating readiness while Continue is enabled. */
  readinessRevalidateInterval: 5_000,
  /** Heartbeat to the exam server while on the System Check screen. */
  networkHeartbeatInterval: 10_000,
  networkPingTimeout: 4_000,
} as const;

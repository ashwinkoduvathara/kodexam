import type { CheckState } from "./types";

export type MediaKind = "camera" | "microphone";

const NOUN: Record<MediaKind, { lower: string; title: string }> = {
  camera: { lower: "camera", title: "Camera" },
  microphone: { lower: "microphone", title: "Microphone" },
};

export function isMediaCaptureSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    // mediaDevices is undefined on insecure origins even though the DOM types say otherwise.
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

/** Blocking state when the browser cannot capture media at all, otherwise null. */
export function getMediaSupportIssue(kind: MediaKind): CheckState | null {
  if (isMediaCaptureSupported()) return null;
  const { lower, title } = NOUN[kind];
  const insecure = typeof window !== "undefined" && !window.isSecureContext;
  return {
    status: "not_available",
    reason: "unsupported",
    label: "Not Supported",
    message: {
      title: `${title} access is unavailable in this browser environment.`,
      description: insecure
        ? "Open the exam over a secure (HTTPS) connection to continue."
        : `Use the latest version of Chrome, Edge or Firefox to allow ${lower} access.`,
    },
  };
}

export function permissionRequiredState(
  kind: MediaKind,
  permission: "denied" | "prompt" | "unknown" = "denied",
): CheckState {
  const { lower, title } = NOUN[kind];
  return {
    status: "failed",
    reason: permission === "prompt" ? "permission_prompt" : "permission_required",
    label: "Permission Required",
    message:
      permission === "prompt"
        ? {
            title: `${title} permission is needed.`,
            description: `Select Try Again and choose "Allow" when your browser asks for ${lower} access.`,
          }
        : {
            title: `${title} access is blocked.`,
            description: `Allow ${lower} access from your browser settings and try again.`,
          },
  };
}

export function noDeviceState(kind: MediaKind): CheckState {
  const { lower, title } = NOUN[kind];
  return {
    status: "not_available",
    reason: "no_device",
    label: kind === "camera" ? "No Camera" : "No Microphone",
    message: {
      title: `No ${lower} was detected.`,
      description: `Connect a ${lower} and try again. ${title}s are picked up automatically once connected.`,
    },
  };
}

export function disconnectedState(kind: MediaKind): CheckState {
  const { lower, title } = NOUN[kind];
  return {
    status: "not_available",
    reason: "disconnected",
    label: "Disconnected",
    message: {
      title: `${title} disconnected.`,
      description: `Reconnect your ${lower}. The check restarts automatically when it's back.`,
    },
  };
}

export function deviceErrorState(kind: MediaKind, message?: CheckState["message"]): CheckState {
  const { lower } = NOUN[kind];
  return {
    status: "failed",
    reason: "device_error",
    label: "Device Error",
    message: message ?? {
      title: `Your ${lower} couldn't be started.`,
      description: `Try again, or choose another ${lower}. If this keeps happening, contact support.`,
    },
  };
}

/**
 * Maps a getUserMedia rejection to a candidate-friendly state.
 * The raw error is never shown to the candidate.
 */
export function describeMediaError(
  error: unknown,
  kind: MediaKind,
  permission: "granted" | "denied" | "prompt" | "unknown" = "unknown",
): CheckState {
  const { lower, title } = NOUN[kind];
  const name =
    error && typeof error === "object" && "name" in error ? String((error as Error).name) : "";

  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return permissionRequiredState(kind, permission === "prompt" ? "prompt" : "denied");
    case "SecurityError":
      return {
        status: "not_available",
        reason: "unsupported",
        label: "Not Supported",
        message: {
          title: `${title} access is unavailable in this browser environment.`,
          description: `Open the exam directly in Chrome, Edge or Firefox (not inside another app) to allow ${lower} access.`,
        },
      };
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return noDeviceState(kind);
    case "NotReadableError":
    case "TrackStartError":
      return deviceErrorState(kind, {
        title: `The ${lower} is currently being used by another application.`,
        description: "Close apps like Zoom, Teams or Meet, then try again.",
      });
    default:
      return deviceErrorState(kind);
  }
}

export function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((track) => track.stop());
}

export async function listDevices(kind: MediaDeviceKind): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === kind && d.deviceId);
  } catch {
    return [];
  }
}

/** Strips the "(046d:0825)" USB vendor/product suffix browsers append to device labels. */
export function cleanDeviceLabel(label: string | undefined, fallback: string): string {
  const cleaned = label?.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "").trim();
  return cleaned || fallback;
}

export function isDeviceGoneError(error: unknown): boolean {
  const name =
    error && typeof error === "object" && "name" in error ? String((error as Error).name) : "";
  return name === "NotFoundError" || name === "OverconstrainedError";
}

export type DevicePermission = "camera" | "microphone";
export type PermissionValue = "granted" | "denied" | "prompt" | "unknown";

/**
 * Queries the Permissions API with feature detection. Returns null when the
 * API — or this permission name — isn't supported (e.g. older Firefox/Safari),
 * so callers fall back to interpreting getUserMedia results.
 */
export async function queryDevicePermission(
  name: DevicePermission,
): Promise<PermissionStatus | null> {
  if (typeof navigator === "undefined" || typeof navigator.permissions?.query !== "function") {
    return null;
  }
  try {
    return await navigator.permissions.query({ name: name as PermissionName });
  } catch {
    return null;
  }
}

export function toPermissionValue(state: string | undefined): PermissionValue {
  return state === "granted" || state === "denied" || state === "prompt" ? state : "unknown";
}

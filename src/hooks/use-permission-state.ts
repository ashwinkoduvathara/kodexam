import { useEffect, useState } from "react";
import {
  queryDevicePermission,
  toPermissionValue,
  type DevicePermission,
  type PermissionValue,
} from "@/lib/exam/permissions";

/**
 * Live camera/microphone permission state ("granted" | "denied" | "prompt"),
 * or "unknown" where the Permissions API isn't available.
 */
export function usePermissionState(name: DevicePermission): PermissionValue {
  const [value, setValue] = useState<PermissionValue>("unknown");

  useEffect(() => {
    let status: PermissionStatus | null = null;
    let cancelled = false;
    const onChange = () => {
      if (status) setValue(toPermissionValue(status.state));
    };
    void queryDevicePermission(name).then((s) => {
      if (cancelled || !s) return;
      status = s;
      setValue(toPermissionValue(s.state));
      s.addEventListener("change", onChange);
    });
    return () => {
      cancelled = true;
      status?.removeEventListener("change", onChange);
    };
  }, [name]);

  return value;
}

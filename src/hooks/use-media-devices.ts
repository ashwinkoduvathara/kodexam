import { useEffect, useState } from "react";

/**
 * Devices of one kind, refreshed on `devicechange`.
 *
 * `devices` only includes entries with an id (labels/ids are exposed after
 * permission is granted). `present` reflects whether *any* device of this kind
 * exists, which browsers report even before permission.
 */
export function useMediaDevices(kind: MediaDeviceKind, refreshKey?: unknown) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [present, setPresent] = useState<boolean | null>(null);

  useEffect(() => {
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!md?.enumerateDevices) return;
    let cancelled = false;

    const refresh = async () => {
      try {
        const all = (await md.enumerateDevices()).filter((d) => d.kind === kind);
        if (cancelled) return;
        setPresent(all.length > 0);
        setDevices(all.filter((d) => d.deviceId));
      } catch {
        /* enumeration can fail transiently while devices change */
      }
    };

    void refresh();
    md.addEventListener("devicechange", refresh);
    return () => {
      cancelled = true;
      md.removeEventListener("devicechange", refresh);
    };
  }, [kind, refreshKey]);

  return { devices, present };
}

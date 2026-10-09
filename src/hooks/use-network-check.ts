import { useCallback, useEffect, useRef, useState } from "react";
import { CHECK_TIMING } from "@/lib/exam/config";
import {
  CONNECTION_LOST_STATE,
  DEFAULT_NETWORK_THRESHOLDS,
  EMPTY_METRICS,
  evaluateNetwork,
  getDefaultNetworkTester,
  SERVER_UNREACHABLE_STATE,
  withTimeout,
  type NetworkMetrics,
  type NetworkTester,
  type NetworkTestPhase,
  type NetworkThresholds,
} from "@/lib/exam/network-test";
import type { CheckState, ProbeResult } from "@/lib/exam/types";

const TESTING: CheckState = { status: "checking", label: "Testing…" };
/** Consecutive failed heartbeats before the connection is treated as lost. */
const HEARTBEAT_FAILURES_FOR_LOSS = 2;

interface UseNetworkCheckOptions {
  tester?: NetworkTester;
  thresholds?: NetworkThresholds;
}

export function useNetworkCheck({
  tester: injected,
  thresholds = DEFAULT_NETWORK_THRESHOLDS,
}: UseNetworkCheckOptions = {}) {
  const tester = injected ?? getDefaultNetworkTester();
  const abortRef = useRef<AbortController | null>(null);
  const lostRef = useRef(false);
  const [state, setState] = useState<CheckState>(TESTING);
  const [metrics, setMetrics] = useState<NetworkMetrics>(EMPTY_METRICS);
  const [phase, setPhase] = useState<NetworkTestPhase | null>(null);
  const [online, setOnline] = useState(true);

  const markLost = useCallback(() => {
    abortRef.current?.abort();
    lostRef.current = true;
    setPhase(null);
    setOnline(false);
    setState(CONNECTION_LOST_STATE);
  }, []);

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (!navigator.onLine) {
      markLost();
      return;
    }
    lostRef.current = false;
    setOnline(true);
    setMetrics(EMPTY_METRICS);
    setState(TESTING);
    try {
      const result = await tester.run({
        signal: controller.signal,
        onPhase: setPhase,
        onProgress: (partial) => setMetrics((m) => ({ ...m, ...partial })),
      });
      if (controller.signal.aborted) return;
      setMetrics(result);
      setState(evaluateNetwork(result, thresholds));
    } catch (error) {
      if (controller.signal.aborted) return;
      console.warn("[kproctor] network test failed", error);
      if (navigator.onLine) setState(SERVER_UNREACHABLE_STATE);
      else markLost();
    } finally {
      if (!controller.signal.aborted) setPhase(null);
    }
  }, [tester, thresholds, markLost]);

  // Browser connectivity events: lose → fail immediately; regain → test again.
  useEffect(() => {
    void run();
    const goOffline = () => markLost();
    const goOnline = () => void run();
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      abortRef.current?.abort();
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, [run, markLost]);

  // Heartbeat: catches "connected to Wi-Fi but no internet", which fires no offline event.
  useEffect(() => {
    let failures = 0;
    const controller = new AbortController();
    const id = window.setInterval(async () => {
      if (!navigator.onLine || document.visibilityState !== "visible") return;
      try {
        await withTimeout(CHECK_TIMING.networkPingTimeout, controller.signal, (s) =>
          tester.ping(s),
        );
        failures = 0;
        if (lostRef.current) void run();
      } catch {
        if (controller.signal.aborted) return;
        failures++;
        if (failures >= HEARTBEAT_FAILURES_FOR_LOSS && !lostRef.current) markLost();
      }
    }, CHECK_TIMING.networkHeartbeatInterval);
    return () => {
      controller.abort();
      window.clearInterval(id);
    };
  }, [tester, run, markLost]);

  const probe = useCallback(async (): Promise<ProbeResult> => {
    if (!navigator.onLine) return { ok: false, reason: "You're offline." };
    try {
      await withTimeout(CHECK_TIMING.networkPingTimeout, undefined, (s) => tester.ping(s));
      return { ok: true };
    } catch {
      return { ok: false, reason: "The exam server isn't reachable." };
    }
  }, [tester]);

  return { state, metrics, phase, online, retry: run, probe };
}

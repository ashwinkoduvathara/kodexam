import type { CheckState } from "./types";

/**
 * Network test abstraction.
 *
 * The UI only depends on `NetworkTester`. The default implementation measures
 * against KProctor's own `/api/network-test/*` endpoints (see src/routes/api).
 * To use a dedicated speed-test provider, implement `NetworkTester` and pass it
 * to <SystemCheck networkTester={...} />.
 */

export interface NetworkMetrics {
  latencyMs: number | null;
  jitterMs: number | null;
  downloadMbps: number | null;
  uploadMbps: number | null;
  /**
   * False when bandwidth can't be measured meaningfully (e.g. the test server is
   * on localhost / the local network). Speeds are then null, never guessed.
   */
  speedTestAvailable: boolean;
}

export type NetworkTestPhase = "latency" | "download" | "upload";

export interface NetworkTestRunOptions {
  signal: AbortSignal;
  onPhase?: (phase: NetworkTestPhase) => void;
  onProgress?: (partial: Partial<NetworkMetrics>) => void;
}

export interface NetworkTester {
  /** Single round-trip to the exam server in ms. Rejects when unreachable. */
  ping(signal: AbortSignal): Promise<number>;
  /** Full measurement: latency, then download/upload when available. */
  run(options: NetworkTestRunOptions): Promise<NetworkMetrics>;
}

export interface NetworkThresholds {
  /** Below these the check fails. */
  minDownloadMbps: number;
  minUploadMbps: number;
  maxLatencyMs: number;
  /** Below these the check passes with a warning. */
  recommendedDownloadMbps: number;
  recommendedUploadMbps: number;
  recommendedLatencyMs: number;
}

/** Proctoring streams webcam + audio upstream, so upload matters as much as download. */
export const DEFAULT_NETWORK_THRESHOLDS: NetworkThresholds = {
  minDownloadMbps: 1.5,
  minUploadMbps: 1,
  maxLatencyMs: 400,
  recommendedDownloadMbps: 5,
  recommendedUploadMbps: 2,
  recommendedLatencyMs: 150,
};

export const EMPTY_METRICS: NetworkMetrics = {
  latencyMs: null,
  jitterMs: null,
  downloadMbps: null,
  uploadMbps: null,
  speedTestAvailable: true,
};

export const CONNECTION_LOST_STATE: CheckState = {
  status: "failed",
  reason: "connection_lost",
  label: "Connection Lost",
  message: {
    title: "Your internet connection was lost.",
    description:
      "Reconnect to continue. The test runs again automatically when you're back online.",
  },
};

export const SERVER_UNREACHABLE_STATE: CheckState = {
  status: "failed",
  reason: "server_unreachable",
  label: "Server Unreachable",
  message: {
    title: "We can't reach the exam server.",
    description: "Check your connection, VPN or firewall settings, then try again.",
  },
};

export function evaluateNetwork(
  m: NetworkMetrics,
  t: NetworkThresholds = DEFAULT_NETWORK_THRESHOLDS,
): CheckState {
  if (m.latencyMs == null) return SERVER_UNREACHABLE_STATE;

  const slow: CheckState = {
    status: "failed",
    reason: "slow_connection",
    label: "Connection Too Slow",
    message: {
      title: "Your connection is too slow for a proctored exam.",
      description:
        "Move closer to your router, use a wired connection or pause other downloads, then try again.",
    },
  };

  if (m.latencyMs > t.maxLatencyMs) return slow;

  const speeds = m.speedTestAvailable && m.downloadMbps != null && m.uploadMbps != null;
  if (speeds && (m.downloadMbps! < t.minDownloadMbps || m.uploadMbps! < t.minUploadMbps)) {
    return slow;
  }

  const belowRecommended =
    m.latencyMs > t.recommendedLatencyMs ||
    (speeds &&
      (m.downloadMbps! < t.recommendedDownloadMbps || m.uploadMbps! < t.recommendedUploadMbps));
  if (belowRecommended) return { status: "warning", label: "Slow Connection" };

  return { status: "passed", label: speeds ? "Stable Connection" : "Connected" };
}

// ─── Default HTTP implementation ─────────────────────────────────────────────

/**
 * Bandwidth measured against a server on the same machine or LAN says nothing
 * about the candidate's internet connection, so it is not reported.
 */
export function isLocalHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 127 ||
    a === 10 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254)
  );
}

export interface HttpNetworkTesterConfig {
  pingUrl: string;
  downloadUrl: string;
  uploadUrl: string;
  pingSamples?: number;
  /** Payload sizes tried in order; stops once a transfer takes longer than `targetSeconds`. */
  downloadSizes?: number[];
  uploadSizes?: number[];
  targetSeconds?: number;
  /** Override automatic detection of whether speeds are meaningful. */
  measureSpeed?: boolean;
}

const KB = 1024;
const MB = 1024 * KB;

function resolveUrl(url: string, params: Record<string, string | number> = {}) {
  const u = new URL(url, window.location.href);
  u.searchParams.set("t", `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u;
}

const toMbps = (bytes: number, seconds: number) => (bytes * 8) / Math.max(seconds, 0.001) / 1e6;

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function createHttpNetworkTester(config: HttpNetworkTesterConfig): NetworkTester {
  const {
    pingUrl,
    downloadUrl,
    uploadUrl,
    pingSamples = 6,
    downloadSizes = [256 * KB, 2 * MB, 8 * MB],
    uploadSizes = [128 * KB, 1 * MB, 4 * MB],
    targetSeconds = 1.5,
  } = config;

  async function ping(signal: AbortSignal) {
    const start = performance.now();
    const res = await fetch(resolveUrl(pingUrl), { cache: "no-store", signal });
    await res.arrayBuffer();
    if (!res.ok) throw new Error(`Ping failed: ${res.status}`);
    return performance.now() - start;
  }

  async function measureLatency(signal: AbortSignal) {
    const samples: number[] = [];
    for (let i = 0; i < pingSamples; i++) {
      const rtt = await ping(signal);
      // First request includes connection setup — discard it.
      if (i > 0) samples.push(rtt);
    }
    const jitter =
      samples.length > 1
        ? samples.slice(1).reduce((acc, v, i) => acc + Math.abs(v - samples[i]), 0) /
          (samples.length - 1)
        : 0;
    return { latencyMs: median(samples), jitterMs: jitter };
  }

  async function measureDownload(signal: AbortSignal, onSample: (mbps: number) => void) {
    let mbps = 0;
    for (const bytes of downloadSizes) {
      const start = performance.now();
      const res = await fetch(resolveUrl(downloadUrl, { bytes }), { cache: "no-store", signal });
      if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`);
      const reader = res.body.getReader();
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
      }
      const seconds = (performance.now() - start) / 1000;
      mbps = toMbps(received, seconds);
      onSample(mbps);
      if (seconds >= targetSeconds) break;
    }
    return mbps;
  }

  async function measureUpload(signal: AbortSignal, onSample: (mbps: number) => void) {
    let mbps = 0;
    for (const bytes of uploadSizes) {
      const payload = new Uint8Array(bytes);
      // Non-trivial data so transparent compression can't skew the result.
      for (let i = 0; i < bytes; i += 4096) payload[i] = (i * 31) & 0xff;
      const start = performance.now();
      const res = await fetch(resolveUrl(uploadUrl), {
        method: "POST",
        body: payload,
        headers: { "content-type": "application/octet-stream" },
        cache: "no-store",
        signal,
      });
      await res.arrayBuffer();
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      const seconds = (performance.now() - start) / 1000;
      mbps = toMbps(bytes, seconds);
      onSample(mbps);
      if (seconds >= targetSeconds) break;
    }
    return mbps;
  }

  return {
    ping,
    async run({ signal, onPhase, onProgress }) {
      const speedTestAvailable =
        config.measureSpeed ?? !isLocalHost(new URL(downloadUrl, window.location.href).hostname);

      onPhase?.("latency");
      const { latencyMs, jitterMs } = await measureLatency(signal);
      onProgress?.({ latencyMs, jitterMs, speedTestAvailable });

      if (!speedTestAvailable) {
        return { latencyMs, jitterMs, downloadMbps: null, uploadMbps: null, speedTestAvailable };
      }

      onPhase?.("download");
      const downloadMbps = await measureDownload(signal, (v) => onProgress?.({ downloadMbps: v }));

      onPhase?.("upload");
      const uploadMbps = await measureUpload(signal, (v) => onProgress?.({ uploadMbps: v }));

      return { latencyMs, jitterMs, downloadMbps, uploadMbps, speedTestAvailable };
    },
  };
}

const NETWORK_TEST_BASE = import.meta.env.VITE_NETWORK_TEST_BASE_URL ?? "/api/network-test";

let defaultTester: NetworkTester | null = null;

export function getDefaultNetworkTester(): NetworkTester {
  defaultTester ??= createHttpNetworkTester({
    pingUrl: `${NETWORK_TEST_BASE}/ping`,
    downloadUrl: `${NETWORK_TEST_BASE}/download`,
    uploadUrl: `${NETWORK_TEST_BASE}/upload`,
  });
  return defaultTester;
}

/** Runs `fn` with an AbortSignal that also aborts after `ms`. */
export async function withTimeout<T>(
  ms: number,
  parent: AbortSignal | undefined,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const onAbort = () => controller.abort();
  parent?.addEventListener("abort", onAbort);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", onAbort);
  }
}

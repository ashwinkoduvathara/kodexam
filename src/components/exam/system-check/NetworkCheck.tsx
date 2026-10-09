import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, Gauge, Globe, Wifi, WifiOff } from "lucide-react";
import { useNetworkCheck } from "@/hooks/use-network-check";
import { useCheckReporting, type CheckReporter } from "@/hooks/use-system-readiness";
import {
  DEFAULT_NETWORK_THRESHOLDS,
  type NetworkTester,
  type NetworkTestPhase,
  type NetworkThresholds,
} from "@/lib/exam/network-test";
import { isCheckBlocked } from "@/lib/exam/types";
import { cn } from "@/lib/utils";
import { CheckAction, CheckWell, SystemCheckCard } from "./SystemCheckCard";

const PHASE_COPY: Record<NetworkTestPhase, string> = {
  latency: "Measuring latency…",
  download: "Measuring download speed…",
  upload: "Measuring upload speed…",
};

function formatSpeed(mbps: number): { value: string; unit: string } {
  if (mbps >= 1000) return { value: (mbps / 1000).toFixed(1), unit: "Gbps" };
  if (mbps >= 100) return { value: Math.round(mbps).toString(), unit: "Mbps" };
  return { value: mbps.toFixed(1), unit: "Mbps" };
}

interface NetworkCheckProps {
  reporter: CheckReporter;
  /** Inject a real speed-test provider; defaults to KProctor's own endpoints. */
  tester?: NetworkTester;
  thresholds?: NetworkThresholds;
}

export function NetworkCheck({
  reporter,
  tester,
  thresholds = DEFAULT_NETWORK_THRESHOLDS,
}: NetworkCheckProps) {
  const { state, metrics, phase, online, retry, probe } = useNetworkCheck({ tester, thresholds });

  useCheckReporting(reporter, "network", state, probe);

  const blocked = isCheckBlocked(state);
  const testing = state.status === "checking";
  const download = metrics.downloadMbps == null ? null : formatSpeed(metrics.downloadMbps);
  const upload = metrics.uploadMbps == null ? null : formatSpeed(metrics.uploadMbps);

  let footnote = "";
  if (testing) footnote = phase ? PHASE_COPY[phase] : "Preparing test…";
  else if (state.status === "warning") footnote = "Usable, but a faster connection is recommended.";
  else if (state.status === "passed") footnote = "Connected to the exam server.";

  return (
    <SystemCheckCard
      checkId="network"
      icon={Wifi}
      issueIcon={WifiOff}
      title="Internet Connection"
      description="Check your internet stability and speed."
      state={state}
      footer={
        <CheckAction emphasis={blocked} disabled={testing} onClick={() => void retry()}>
          {blocked ? "Try Again" : testing ? "Testing…" : "Test Again"}
        </CheckAction>
      }
    >
      <CheckWell>
        <dl className="divide-y divide-slate-200/70">
          <Row icon={<Globe className="h-3.5 w-3.5" />} label="Status">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-[12px] font-bold",
                online ? "text-brand-strong" : "text-red-700",
              )}
            >
              <span
                className={cn("h-2 w-2 rounded-full", online ? "bg-brand" : "bg-red-500")}
                aria-hidden
              />
              {online ? "Online" : "Offline"}
            </span>
          </Row>
          <Row icon={<Gauge className="h-3.5 w-3.5" />} label="Latency">
            <Value
              value={
                metrics.latencyMs == null ? undefined : Math.round(metrics.latencyMs).toString()
              }
              unit="ms"
              pending={testing && phase === "latency"}
            />
          </Row>
          {metrics.speedTestAvailable ? (
            <>
              <Row icon={<ArrowDown className="h-3.5 w-3.5" />} label="Download">
                <Value
                  value={download?.value}
                  unit={download?.unit ?? "Mbps"}
                  pending={testing && phase !== "upload"}
                />
              </Row>
              <Row icon={<ArrowUp className="h-3.5 w-3.5" />} label="Upload">
                <Value value={upload?.value} unit={upload?.unit ?? "Mbps"} pending={testing} />
              </Row>
            </>
          ) : (
            <Row icon={<ArrowDown className="h-3.5 w-3.5" />} label="Speed">
              <span className="text-right text-[11px] font-semibold leading-tight text-slate-600">
                Speed test unavailable
              </span>
            </Row>
          )}
        </dl>
        <p className="mt-auto pt-2 text-[11px] text-slate-600" aria-live="polite">
          {footnote}
        </p>
      </CheckWell>
    </SystemCheckCard>
  );
}

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-2 py-1.5 first:pt-0 short:min-h-8">
      <dt className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
        <span
          className="grid h-5 w-5 place-items-center rounded-md bg-white text-slate-500 ring-1 ring-slate-200/70"
          aria-hidden
        >
          {icon}
        </span>
        {label}
      </dt>
      <dd className="flex items-baseline justify-end gap-1">{children}</dd>
    </div>
  );
}

function Value({
  value,
  unit,
  pending,
}: {
  value: string | undefined;
  unit: string;
  pending: boolean;
}) {
  if (value !== undefined) {
    return (
      <>
        <span className="text-[16px] font-extrabold leading-none tabular-nums tracking-tight text-navy">
          {value}
        </span>
        <span className="text-[10px] font-semibold text-slate-500">{unit}</span>
      </>
    );
  }
  if (pending) {
    return (
      <span className="h-4 w-12 animate-pulse self-center rounded bg-slate-200">
        <span className="sr-only">Measuring</span>
      </span>
    );
  }
  return (
    <span className="text-[16px] font-extrabold leading-none text-slate-300">
      —<span className="sr-only">Not measured</span>
    </span>
  );
}

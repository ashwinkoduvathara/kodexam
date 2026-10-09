import { Mic, MicOff, MousePointerClick } from "lucide-react";
import { useMicrophoneCheck } from "@/hooks/use-microphone-check";
import { useCheckReporting, type CheckReporter } from "@/hooks/use-system-readiness";
import { isCheckBlocked } from "@/lib/exam/types";
import { cn } from "@/lib/utils";
import { DeviceMenu } from "./DeviceMenu";
import {
  CheckAction,
  CheckWell,
  CheckWellLabel,
  RetestButton,
  SystemCheckCard,
} from "./SystemCheckCard";

const SEGMENTS = 12;

export function MicrophoneCheck({ reporter }: { reporter: CheckReporter }) {
  const {
    state,
    level,
    deviceLabel,
    devices,
    activeDeviceId,
    quiet,
    needsGesture,
    retry,
    selectDevice,
    probe,
  } = useMicrophoneCheck({ segments: SEGMENTS });

  useCheckReporting(reporter, "microphone", state, probe);

  const blocked = isCheckBlocked(state);
  const passed = state.status === "passed";
  const waiting = state.label === "Waiting for Permission";

  return (
    <SystemCheckCard
      checkId="microphone"
      icon={Mic}
      issueIcon={MicOff}
      title="Microphone"
      description="Check if your microphone is detecting your voice."
      state={state}
      footer={
        blocked && state.reason !== "no_input" ? (
          <CheckAction emphasis onClick={() => void retry()}>
            Try Again
          </CheckAction>
        ) : (
          <div className="flex gap-2">
            <DeviceMenu
              label="Change Mic"
              ariaLabel="Change microphone"
              heading="Available microphones"
              fallbackName="Microphone"
              devices={devices}
              activeDeviceId={activeDeviceId}
              onSelect={(id) => void selectDevice(id)}
            />
            <RetestButton label="Test microphone again" onClick={() => void retry()} />
          </div>
        )
      }
    >
      <CheckWell>
        <CheckWellLabel
          aside={
            passed && (
              <span className="text-[10px] font-bold text-brand-strong">Voice detected</span>
            )
          }
        >
          Input Level
        </CheckWellLabel>

        <div
          role="meter"
          aria-label="Microphone input level"
          aria-valuemin={0}
          aria-valuemax={SEGMENTS}
          aria-valuenow={level}
          aria-valuetext={`${level} of ${SEGMENTS}`}
          className="mt-3 flex h-11 items-end gap-[3px]"
        >
          {Array.from({ length: SEGMENTS }, (_, i) => (
            <span
              key={i}
              className={cn(
                "flex-1 rounded-[3px] transition-colors duration-75",
                i < level ? "bg-brand" : "bg-slate-200/80",
              )}
              style={{ height: `${36 + (i / (SEGMENTS - 1)) * 64}%` }}
            />
          ))}
        </div>

        <div className="mt-auto pt-3 text-[11px] leading-relaxed">
          {needsGesture ? (
            <p className="flex items-start gap-1.5 font-semibold text-slate-700">
              <MousePointerClick className="mt-px h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
              Click anywhere on the page to activate the level meter.
            </p>
          ) : waiting ? (
            <p className="font-semibold text-slate-700">
              Allow microphone access when your browser asks.
            </p>
          ) : passed ? (
            <p className="flex items-center gap-1.5 font-medium text-slate-600">
              <Mic className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
              <span className="truncate" title={deviceLabel ?? undefined}>
                {deviceLabel}
              </span>
            </p>
          ) : quiet ? (
            <p className="font-semibold text-amber-800">
              We can hear your microphone but not your voice yet. Speak a little louder.
            </p>
          ) : (
            <p className="text-slate-600">
              Say <span className="font-semibold text-navy">“I'm ready for my exam”</span> to test
              your microphone.
            </p>
          )}
        </div>
      </CheckWell>
    </SystemCheckCard>
  );
}

import { AlertCircle, Camera, CameraOff, CheckCircle2, CircleDashed, Loader2 } from "lucide-react";
import { useCameraCheck } from "@/hooks/use-camera-check";
import { useCheckReporting, type CheckReporter } from "@/hooks/use-system-readiness";
import type { FaceDetectionProvider, FrameSignal } from "@/lib/exam/frame-analysis";
import { isCheckBlocked } from "@/lib/exam/types";
import { cn } from "@/lib/utils";
import { DeviceMenu } from "./DeviceMenu";
import { CheckAction, RetestButton, SystemCheckCard } from "./SystemCheckCard";

interface CameraCheckProps {
  reporter: CheckReporter;
  faceDetector?: FaceDetectionProvider | null;
}

export function CameraCheck({ reporter, faceDetector }: CameraCheckProps) {
  const { videoRef, state, stream, devices, activeDeviceId, quality, retry, selectDevice, probe } =
    useCameraCheck({ faceDetector });

  useCheckReporting(reporter, "camera", state, probe);

  const blocked = isCheckBlocked(state);
  const live = state.status === "passed";
  const checking = state.status === "checking";
  const faceVerified = quality.faceInFrame !== "unknown" || quality.faceVisible !== "unknown";

  return (
    <SystemCheckCard
      checkId="camera"
      icon={Camera}
      issueIcon={CameraOff}
      title="Camera"
      description="Check if your webcam is working properly."
      state={state}
      persistentChildren
      footer={
        blocked ? (
          <CheckAction emphasis onClick={() => void retry()}>
            Try Again
          </CheckAction>
        ) : (
          <div className="flex gap-2">
            <DeviceMenu
              label="Change Camera"
              ariaLabel="Change camera"
              heading="Available cameras"
              fallbackName="Camera"
              devices={devices}
              activeDeviceId={activeDeviceId}
              onSelect={(id) => void selectDevice(id)}
              disabled={checking}
            />
            <RetestButton
              label="Test camera again"
              onClick={() => void retry()}
              disabled={checking}
            />
          </div>
        )
      }
    >
      <div className="relative aspect-video overflow-hidden rounded-xl bg-slate-900 short:aspect-[2/1]">
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          aria-label="Your live webcam preview. It stays on this device and is not recorded."
          className={cn(
            "mirror h-full w-full object-cover transition-opacity duration-300",
            stream ? "opacity-100" : "opacity-0",
          )}
        />
        {checking && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900/40 text-white/90">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            <span className="px-3 text-center text-[11px] font-semibold">
              {state.label === "Waiting for Permission"
                ? "Allow camera access in your browser"
                : "Checking camera…"}
            </span>
          </div>
        )}
        {live && (
          <span className="absolute bottom-2 left-2 inline-flex items-center gap-1.5 rounded-full bg-slate-900/75 px-2 py-1 text-[10px] font-semibold text-white">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
            Camera is active
          </span>
        )}
      </div>

      <ul
        className="mt-2.5 grid grid-cols-2 gap-x-2 gap-y-1 short:mt-2"
        aria-label="Camera readiness"
      >
        <QualityItem
          label="Good lighting"
          signal={live ? quality.lighting : "unknown"}
          failText="Adjust lighting"
        />
        <QualityItem label="Face in frame" signal={quality.faceInFrame} failText="Not in frame" />
        <QualityItem label="Face visible" signal={quality.faceVisible} failText="Move closer" />
      </ul>
      {!faceVerified && (
        <p className="mt-1 text-[10px] leading-snug text-slate-500">
          Face checks: will be verified during Identity Verification.
        </p>
      )}
    </SystemCheckCard>
  );
}

function QualityItem({
  label,
  signal,
  failText,
}: {
  label: string;
  signal: FrameSignal;
  failText: string;
}) {
  const Icon = signal === "pass" ? CheckCircle2 : signal === "fail" ? AlertCircle : CircleDashed;
  const srStatus =
    signal === "pass" ? "verified" : signal === "fail" ? failText : "not verified yet";
  return (
    <li
      className={cn(
        "flex min-w-0 items-center gap-1 text-[11px] font-semibold",
        signal === "pass" && "text-slate-700",
        signal === "fail" && "text-amber-800",
        signal === "unknown" && "text-slate-500",
      )}
    >
      <Icon
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          signal === "pass" && "text-brand",
          signal === "fail" && "text-amber-600",
          signal === "unknown" && "text-slate-400",
        )}
        aria-hidden
      />
      <span className="truncate">{signal === "fail" ? failText : label}</span>
      <span className="sr-only">: {srStatus}</span>
    </li>
  );
}

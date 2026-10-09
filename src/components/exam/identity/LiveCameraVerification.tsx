import { useEffect, useState } from "react";
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  CircleDashed,
  Glasses,
  Loader2,
  RotateCcw,
  ScanFace,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCameraCheck } from "@/hooks/use-camera-check";
import { captureStill } from "@/lib/exam/identity/identity-service";
import type { FrameSignal } from "@/lib/exam/frame-analysis";
import { cn } from "@/lib/utils";
import { SectionHeading } from "../instructions/SectionHeading";

interface LiveCameraVerificationProps {
  /** Server says a verification photo is already stored. */
  photoCaptured: boolean;
  photoCapturedAt: string | null;
  /** Local, in-memory preview of the photo captured in this page session. */
  photoPreviewUrl: string | null;
  canCapture: boolean;
  capturing: boolean;
  error: string | null;
  onCapture: (photo: Blob) => Promise<void>;
  /** Reports whether the live camera currently meets the requirements. */
  onReadyChange: (ready: boolean) => void;
}

export function LiveCameraVerification({
  photoCaptured,
  photoCapturedAt,
  photoPreviewUrl,
  canCapture,
  capturing,
  error,
  onCapture,
  onReadyChange,
}: LiveCameraVerificationProps) {
  const { videoRef, state, stream, quality, retry } = useCameraCheck();
  const [captureError, setCaptureError] = useState<string | null>(null);

  const live = state.status === "passed";
  const detectorAvailable = quality.faceInFrame !== "unknown" || quality.faceVisible !== "unknown";
  const faceOk =
    !detectorAvailable || (quality.faceInFrame === "pass" && quality.faceVisible === "pass");
  const lightingOk = quality.lighting !== "fail";
  const cameraReady = live && lightingOk && faceOk;

  useEffect(() => onReadyChange(live), [live, onReadyChange]);

  const blocked = state.status === "failed" || state.status === "not_available";

  const handleCapture = async () => {
    const video = videoRef.current;
    if (!video || !cameraReady) return;
    setCaptureError(null);
    try {
      await onCapture(await captureStill(video));
    } catch {
      setCaptureError("We couldn't capture your photo. Please try again.");
    }
  };

  let hint: { tone: "ok" | "warn" | "neutral"; text: string };
  if (!live) hint = { tone: "neutral", text: "Starting camera…" };
  else if (!lightingOk) hint = { tone: "warn", text: "Poor lighting — face a light source" };
  else if (detectorAvailable && quality.faceInFrame === "fail")
    hint = { tone: "warn", text: "Face not detected — centre your face in the guide" };
  else if (detectorAvailable && quality.faceVisible === "fail")
    hint = { tone: "warn", text: "Face outside frame — move a little closer" };
  else if (detectorAvailable) hint = { tone: "ok", text: "Face detected" };
  else hint = { tone: "neutral", text: "Align your face within the guide" };

  return (
    <section
      aria-labelledby="idv-camera-heading"
      data-section="camera"
      className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <SectionHeading
          id="idv-camera-heading"
          icon={Camera}
          title="Live Camera Verification"
          description="Position your face clearly within the frame."
        />
        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-slate-600">
          <span
            className={cn("h-2 w-2 rounded-full", live ? "bg-brand" : "bg-slate-300")}
            aria-hidden
          />
          {live ? "Camera is active" : blocked ? "Camera unavailable" : "Camera starting"}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] gap-3">
        <div className="relative aspect-[3/2] overflow-hidden rounded-xl bg-slate-900">
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            aria-label="Your live camera preview. It stays on this device."
            className={cn(
              "mirror h-full w-full object-cover",
              stream ? "opacity-100" : "opacity-0",
            )}
          />
          {live && (
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute left-1/2 top-1/2 h-[68%] w-[46%] -translate-x-1/2 -translate-y-1/2 rounded-[40%] border-2 border-dashed",
                hint.tone === "warn" ? "border-amber-300" : "border-emerald-300/90",
              )}
            />
          )}
          {!live && !blocked && (
            <div className="absolute inset-0 grid place-items-center text-white/85">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            </div>
          )}
          {blocked && (
            <div
              role="alert"
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900 px-6 text-center text-white"
            >
              <AlertCircle className="h-6 w-6 text-amber-300" aria-hidden />
              <p className="text-sm font-bold">{state.message?.title ?? "Camera unavailable"}</p>
              <p className="text-xs text-white/75">{state.message?.description}</p>
              <Button
                size="sm"
                onClick={() => void retry()}
                className="mt-1 h-8 rounded-lg text-xs font-bold"
              >
                Try Again
              </Button>
            </div>
          )}
          {live && (
            <span
              role="status"
              className={cn(
                "absolute bottom-2 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold",
                hint.tone === "ok" && "bg-slate-900/75 text-white",
                hint.tone === "warn" && "bg-amber-500/90 text-white",
                hint.tone === "neutral" && "bg-slate-900/75 text-white",
              )}
            >
              {hint.tone === "ok" ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" aria-hidden />
              ) : hint.tone === "warn" ? (
                <AlertCircle className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <ScanFace className="h-3.5 w-3.5" aria-hidden />
              )}
              {hint.text}
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <Requirement
            icon={null}
            signal={live ? quality.lighting : "unknown"}
            title="Good lighting"
            pass="Lighting looks good"
            fail="Too dark or too bright"
          />
          <Requirement
            icon={null}
            signal={quality.faceInFrame}
            title="Face in frame"
            pass="Your face is within the frame"
            fail="Keep your face within the frame"
            unknownText="Confirmed by the reviewer"
          />
          <Requirement
            icon={Glasses}
            signal="unknown"
            title="No sunglasses"
            unknownText="Remove sunglasses or hats"
            pass=""
            fail=""
          />
          <Requirement
            icon={null}
            signal={quality.faceVisible}
            title="Face visible"
            pass="Look directly at the camera"
            fail="Move closer to the camera"
            unknownText="Confirmed by the reviewer"
          />

          <div className="mt-auto">
            {photoCaptured && (
              <div className="mb-2 flex items-center gap-2 rounded-lg border border-brand/20 bg-brand-soft/60 px-2 py-1.5">
                {photoPreviewUrl ? (
                  <img
                    src={photoPreviewUrl}
                    alt="Your captured verification photo"
                    className="h-9 w-12 rounded object-cover"
                  />
                ) : (
                  <span className="grid h-9 w-9 place-items-center rounded bg-white text-brand">
                    <CheckCircle2 className="h-4 w-4" aria-hidden />
                  </span>
                )}
                <p className="text-[11px] leading-tight text-slate-700">
                  <span className="block font-bold text-brand-strong">Photo captured</span>
                  {photoCapturedAt && new Date(photoCapturedAt).toLocaleTimeString()}
                </p>
              </div>
            )}
            <Button
              onClick={() => void handleCapture()}
              disabled={!canCapture || !cameraReady || capturing}
              variant={photoCaptured ? "outline" : "default"}
              className={cn(
                "h-10 w-full rounded-xl text-xs font-bold",
                photoCaptured && "border-slate-200 text-navy shadow-none",
              )}
            >
              {capturing ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : photoCaptured ? (
                <RotateCcw aria-hidden />
              ) : (
                <Camera aria-hidden />
              )}
              {capturing ? "Saving photo…" : photoCaptured ? "Retake Photo" : "Capture Photo"}
            </Button>
            {(error || captureError) && (
              <p role="alert" className="mt-1.5 text-[11px] font-semibold text-red-700">
                {error ?? captureError}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Requirement({
  icon,
  signal,
  title,
  pass,
  fail,
  unknownText = "Checking…",
}: {
  icon: LucideIcon | null;
  signal: FrameSignal;
  title: string;
  pass: string;
  fail: string;
  unknownText?: string;
}) {
  const Icon =
    icon ?? (signal === "pass" ? CheckCircle2 : signal === "fail" ? AlertCircle : CircleDashed);
  const text = signal === "pass" ? pass : signal === "fail" ? fail : unknownText;
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-1.5">
      <span
        className={cn(
          "grid h-7 w-7 shrink-0 place-items-center rounded-full",
          signal === "pass" && "bg-brand text-white",
          signal === "fail" && "bg-amber-100 text-amber-700",
          signal === "unknown" && "bg-slate-100 text-slate-500",
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 leading-tight">
        <p className="text-xs font-bold text-navy">{title}</p>
        <p
          className={cn(
            "mt-0.5 truncate text-[11px]",
            signal === "fail" ? "text-amber-800" : "text-slate-500",
          )}
        >
          {text}
          <span className="sr-only">
            {signal === "pass"
              ? " (passed)"
              : signal === "fail"
                ? " (needs attention)"
                : " (not checked automatically)"}
          </span>
        </p>
      </div>
    </div>
  );
}

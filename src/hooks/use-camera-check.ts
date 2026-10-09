import { useCallback, useEffect, useRef, useState } from "react";
import { CHECK_TIMING } from "@/lib/exam/config";
import {
  createNativeFaceDetector,
  faceSignals,
  lightingSignal,
  measureBrightness,
  UNKNOWN_FRAME_QUALITY,
  type FaceDetectionProvider,
  type FrameQuality,
} from "@/lib/exam/frame-analysis";
import {
  describeMediaError,
  deviceErrorState,
  disconnectedState,
  getMediaSupportIssue,
  isDeviceGoneError,
  permissionRequiredState,
} from "@/lib/exam/media";
import { registerStream, releaseStream } from "@/lib/exam/media-registry";
import type { CheckState, ProbeResult } from "@/lib/exam/types";
import { useLatest } from "./use-latest";
import { useMediaDevices } from "./use-media-devices";
import { usePermissionState } from "./use-permission-state";

const CHECKING: CheckState = { status: "checking", label: "Checking camera…" };
const WAITING_PERMISSION: CheckState = { status: "checking", label: "Waiting for Permission" };
const PASSED: CheckState = { status: "passed", label: "Working Properly" };

const TIMEOUT_STATE: CheckState = {
  status: "failed",
  reason: "timeout",
  label: "Not Responding",
  message: {
    title: "Your camera didn't start in time.",
    description:
      "Open the privacy shutter, close other apps using the camera, or choose another camera.",
  },
};

const STALLED_STATE = deviceErrorState("camera", {
  title: "Your camera stopped sending video.",
  description: "Check the camera connection or privacy shutter, then try again.",
});

const fail = (reason: string): ProbeResult => ({ ok: false, reason });

interface UseCameraCheckOptions {
  /** Inject a face detector; `undefined` uses the browser's native one where available. */
  faceDetector?: FaceDetectionProvider | null;
}

export function useCameraCheck({ faceDetector }: UseCameraCheckOptions = {}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const attemptRef = useRef(0);
  /** Invalidates any in-flight getUserMedia call so its result is discarded. */
  const invalidate = useCallback(() => {
    attemptRef.current++;
  }, []);
  const lastFrameAtRef = useRef(0);

  const permission = usePermissionState("camera");
  const [state, setState] = useState<CheckState>(CHECKING);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [activeDeviceId, setActiveDeviceId] = useState<string | undefined>();
  const [quality, setQuality] = useState<FrameQuality>(UNKNOWN_FRAME_QUALITY);
  const { devices, present } = useMediaDevices("videoinput", stream);

  /** Stops every track of the current stream and detaches it from the preview. */
  const release = useCallback(() => {
    const video = videoRef.current;
    if (video?.srcObject instanceof MediaStream) {
      video.srcObject.getTracks().forEach((track) => track.stop());
    }
    if (video) video.srcObject = null;
    releaseStream(streamRef.current);
    streamRef.current = null;
    setStream(null);
  }, []);

  const latest = useLatest({ permission, state, activeDeviceId });

  const start = useCallback(
    async (deviceId?: string) => {
      const attempt = ++attemptRef.current;
      release();
      setQuality(UNKNOWN_FRAME_QUALITY);

      const unsupported = getMediaSupportIssue("camera");
      if (unsupported) {
        setState(unsupported);
        return;
      }
      setState(latest.current.permission === "prompt" ? WAITING_PERMISSION : CHECKING);

      const open = (id?: string) =>
        navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            ...(id ? { deviceId: { exact: id } } : { facingMode: "user" }),
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });

      let media: MediaStream;
      try {
        try {
          media = await open(deviceId);
        } catch (error) {
          // The selected camera was unplugged — fall back to the default one.
          if (deviceId && isDeviceGoneError(error)) media = await open();
          else throw error;
        }
      } catch (error) {
        if (attempt !== attemptRef.current) return;
        console.warn("[kproctor] camera start failed", error);
        setState(describeMediaError(error, "camera", latest.current.permission));
        return;
      }

      if (attempt !== attemptRef.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }

      registerStream(media);
      const [track] = media.getVideoTracks();
      let muteTimer = 0;
      track.addEventListener("ended", () => {
        if (attempt !== attemptRef.current) return;
        release();
        setState(
          latest.current.permission === "denied"
            ? permissionRequiredState("camera")
            : disconnectedState("camera"),
        );
      });
      track.addEventListener("mute", () => {
        window.clearTimeout(muteTimer);
        muteTimer = window.setTimeout(() => {
          if (attempt === attemptRef.current && track.muted) setState(STALLED_STATE);
        }, CHECK_TIMING.cameraStallTimeout);
      });
      track.addEventListener("unmute", () => window.clearTimeout(muteTimer));

      streamRef.current = media;
      setActiveDeviceId(track.getSettings().deviceId ?? deviceId);
      setStream(media);
    },
    [release, latest],
  );

  // Attach the stream and only report "passed" once a real video frame has rendered.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;

    video.srcObject = stream;
    let cancelled = false;
    let verified = false;
    let rvfcHandle = 0;
    let timeout = 0;

    const onFrame = () => {
      lastFrameAtRef.current = performance.now();
      if (!verified && video.videoWidth > 0) {
        verified = true;
        window.clearTimeout(timeout);
        setState(PASSED);
      }
    };

    const supportsRVFC = "requestVideoFrameCallback" in HTMLVideoElement.prototype;
    const loop = () => {
      if (cancelled) return;
      onFrame();
      rvfcHandle = video.requestVideoFrameCallback(loop);
    };
    if (supportsRVFC) rvfcHandle = video.requestVideoFrameCallback(loop);
    else video.addEventListener("timeupdate", onFrame);

    // Frames aren't rendered in background tabs, so only time out while visible.
    const armTimeout = () => {
      timeout = window.setTimeout(() => {
        if (cancelled || verified) return;
        if (document.visibilityState !== "visible") armTimeout();
        else setState(TIMEOUT_STATE);
      }, CHECK_TIMING.cameraFrameTimeout);
    };
    armTimeout();

    video.play().catch(() => {
      /* muted inline autoplay is always allowed; ignore aborts during teardown */
    });

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      if (supportsRVFC) video.cancelVideoFrameCallback(rvfcHandle);
      else video.removeEventListener("timeupdate", onFrame);
    };
  }, [stream]);

  // Watchdog: a passed camera that stops producing frames fails again.
  const passed = state.status === "passed";
  useEffect(() => {
    if (!passed) return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        lastFrameAtRef.current = performance.now();
        return;
      }
      if (performance.now() - lastFrameAtRef.current > CHECK_TIMING.cameraStallTimeout) {
        setState(STALLED_STATE);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [passed]);

  // Lighting (measured) and face signals (only when a real detector is available).
  useEffect(() => {
    if (!passed) return;
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement("canvas");
    const detector = faceDetector === undefined ? createNativeFaceDetector() : faceDetector;
    let cancelled = false;
    let busy = false;

    const analyse = async () => {
      if (busy || video.readyState < 2) return;
      busy = true;
      try {
        const lighting = lightingSignal(measureBrightness(video, canvas));
        let faces: Omit<FrameQuality, "lighting"> = {
          faceInFrame: "unknown",
          faceVisible: "unknown",
        };
        if (detector) {
          try {
            const detected = await Promise.race([
              detector.detect(video),
              new Promise<never>((_, reject) =>
                window.setTimeout(() => reject(new Error("Face detection timed out")), 2000),
              ),
            ]);
            faces = faceSignals(detected, video.videoWidth, video.videoHeight);
          } catch {
            /* detector unavailable or stalled — leave face signals unverified */
          }
        }
        if (!cancelled) {
          setQuality((prev) => {
            const next: FrameQuality = { ...faces, lighting };
            return (Object.keys(next) as (keyof FrameQuality)[]).every((k) => prev[k] === next[k])
              ? prev
              : next;
          });
        }
      } finally {
        busy = false;
      }
    };

    void analyse();
    const interval = window.setInterval(analyse, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [passed, faceDetector, stream]);

  // Permission granted (e.g. from browser settings) → retry; revoked → stop and explain.
  useEffect(() => {
    const { state: current, activeDeviceId: deviceId } = latest.current;
    const waitingOnPermission =
      current.reason === "permission_required" || current.reason === "permission_prompt";
    if (permission === "granted" && waitingOnPermission) void start(deviceId);
    if (permission === "denied" && current.reason !== "permission_required") {
      invalidate();
      release();
      setState(permissionRequiredState("camera"));
    }
  }, [permission, start, release, latest, invalidate]);

  // Camera reconnected after "no device" / "disconnected" → restart automatically.
  // Only fires when a device appears, so a still-missing device can't cause a retry loop.
  const reason = state.reason;
  const prevPresentRef = useRef(present);
  useEffect(() => {
    const appeared = present === true && prevPresentRef.current === false;
    prevPresentRef.current = present;
    if (appeared && (reason === "no_device" || reason === "disconnected")) void start();
  }, [present, reason, start]);

  // Initial start + cleanup on unmount (route change) and page unload.
  useEffect(() => {
    void start();
    const onPageHide = () => {
      invalidate();
      release();
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      invalidate();
      release();
    };
  }, [start, release, invalidate]);

  /** Inspects the real stream and preview — the final authority for readiness. */
  const probe = useCallback((): ProbeResult => {
    const track = streamRef.current?.getVideoTracks()[0];
    const video = videoRef.current;
    if (!track || track.readyState !== "live") return fail("Camera stream is not active.");
    if (track.muted) return fail("Camera is not sending video.");
    if (!video || video.readyState < 2 || video.videoWidth === 0) {
      return fail("Camera preview has no video.");
    }
    if (
      document.visibilityState === "visible" &&
      performance.now() - lastFrameAtRef.current > CHECK_TIMING.cameraStallTimeout
    ) {
      return fail("Camera stopped sending video.");
    }
    return { ok: true };
  }, []);

  const retry = useCallback(() => start(activeDeviceId), [start, activeDeviceId]);

  return {
    videoRef,
    state,
    stream,
    devices,
    activeDeviceId,
    quality,
    permission,
    retry,
    selectDevice: start,
    probe,
  };
}

import { useCallback, useEffect, useRef, useState } from "react";
import { registerStream, releaseStream } from "@/lib/exam/media-registry";

/**
 * Real device state during the running exam:
 * - `live`        the track is running AND (camera) frames are actually arriving
 * - `starting`    waiting for the device / first frame
 * - `stalled`     the track exists but no frames (camera) or it is muted (microphone)
 * - `disconnected` the track ended (unplugged, revoked, taken by another app)
 * - `blocked`     permission denied
 * - `unavailable` no device / browser support
 * - `not_required` the exam policy doesn't require this device
 * A granted permission alone never counts as `live`.
 */
export type DeviceStatus =
  "not_required" | "starting" | "live" | "stalled" | "disconnected" | "blocked" | "unavailable";

export const isDeviceFailure = (s: DeviceStatus) =>
  s === "stalled" || s === "disconnected" || s === "blocked" || s === "unavailable";

/** No new video frame for this long → the camera is considered stalled. */
const FRAME_STALL_MS = 3000;
/** No first frame within this long after opening the camera → stalled. */
const FIRST_FRAME_TIMEOUT_MS = 8000;

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

function failureFor(error: unknown): DeviceStatus {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "blocked";
  if (name === "NotReadableError" || name === "AbortError") return "disconnected";
  return "unavailable";
}

export function useExamMonitoring({
  camera: cameraRequired,
  microphone: microphoneRequired,
}: {
  camera: boolean;
  microphone: boolean;
}) {
  const [camera, setCamera] = useState<DeviceStatus>(cameraRequired ? "starting" : "not_required");
  const [microphone, setMicrophone] = useState<DeviceStatus>(
    microphoneRequired ? "starting" : "not_required",
  );
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const attemptRef = useRef(0);
  /** Invalidates any in-flight getUserMedia call so its result is discarded. */
  const invalidate = useCallback(() => {
    attemptRef.current++;
  }, []);
  const lastFrameAt = useRef(0);
  const openedAt = useRef(0);

  const stop = useCallback(() => {
    releaseStream(streamRef.current);
    streamRef.current = null;
    setStream(null);
  }, []);

  const start = useCallback(async () => {
    const attempt = ++attemptRef.current;
    stop();
    if (!cameraRequired && !microphoneRequired) return;
    if (cameraRequired) setCamera("starting");
    if (microphoneRequired) setMicrophone("starting");
    if (!navigator.mediaDevices?.getUserMedia) {
      if (cameraRequired) setCamera("unavailable");
      if (microphoneRequired) setMicrophone("unavailable");
      return;
    }

    // Each device is opened separately so one failing doesn't take the other down.
    const open = async (kind: "video" | "audio") => {
      try {
        return await navigator.mediaDevices.getUserMedia(
          kind === "video"
            ? { video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } }
            : { audio: { echoCancellation: true, noiseSuppression: true } },
        );
      } catch (error) {
        return failureFor(error);
      }
    };
    const [videoResult, audioResult] = await Promise.all([
      cameraRequired ? open("video") : Promise.resolve(null),
      microphoneRequired ? open("audio") : Promise.resolve(null),
    ]);
    const tracks = [videoResult, audioResult].flatMap((r) =>
      r instanceof MediaStream ? r.getTracks() : [],
    );
    if (attempt !== attemptRef.current) {
      tracks.forEach((t) => t.stop());
      return;
    }

    const media = registerStream(new MediaStream(tracks));
    streamRef.current = media;
    setStream(media);

    if (typeof videoResult === "string") setCamera(videoResult);
    if (typeof audioResult === "string") setMicrophone(audioResult);

    const [videoTrack] = media.getVideoTracks();
    if (videoTrack) {
      lastFrameAt.current = 0;
      openedAt.current = performance.now();
      videoTrack.addEventListener("ended", () => {
        if (attempt === attemptRef.current) setCamera("disconnected");
      });
    }
    const [audioTrack] = media.getAudioTracks();
    if (audioTrack) {
      const update = () => {
        if (attempt !== attemptRef.current) return;
        if (audioTrack.readyState === "ended") setMicrophone("disconnected");
        else setMicrophone(audioTrack.muted ? "stalled" : "live");
      };
      audioTrack.addEventListener("ended", update);
      audioTrack.addEventListener("mute", update);
      audioTrack.addEventListener("unmute", update);
      update();
    }
  }, [cameraRequired, microphoneRequired, stop]);

  // Attach the stream to the preview element.
  useEffect(() => {
    if (!video) return;
    // The stream carries the microphone too: never play it back to the candidate.
    video.muted = true;
    video.srcObject = stream;
    if (stream) void video.play().catch(() => undefined);
  }, [video, stream]);

  // Frame watchdog: "live" only while frames keep arriving.
  useEffect(() => {
    const v = video as VideoWithFrameCallback | null;
    if (!v || !stream || !stream.getVideoTracks().length) return;
    let handle = 0;
    let lastTime = -1;
    const onFrame = () => {
      lastFrameAt.current = performance.now();
      handle = v.requestVideoFrameCallback!(onFrame);
    };
    if (v.requestVideoFrameCallback) handle = v.requestVideoFrameCallback(onFrame);
    const timer = window.setInterval(() => {
      if (!v.requestVideoFrameCallback && v.currentTime !== lastTime) {
        lastTime = v.currentTime;
        lastFrameAt.current = performance.now();
      }
      const [track] = stream.getVideoTracks();
      // `ended` doesn't fire when a track is stopped programmatically, so poll it too.
      if (!track || track.readyState === "ended") {
        setCamera("disconnected");
        return;
      }
      const fresh = performance.now() - lastFrameAt.current < FRAME_STALL_MS;
      setCamera((prev) => {
        if (fresh) return "live";
        if (lastFrameAt.current === 0) {
          const waiting = performance.now() - openedAt.current < FIRST_FRAME_TIMEOUT_MS;
          return prev === "starting" && waiting ? prev : "stalled";
        }
        return "stalled";
      });
    }, 1000);
    return () => {
      window.clearInterval(timer);
      if (handle) v.cancelVideoFrameCallback?.(handle);
    };
  }, [video, stream]);

  // Microphone watchdog: catches tracks that ended without an `ended` event.
  useEffect(() => {
    const [track] = stream?.getAudioTracks() ?? [];
    if (!track) return;
    const timer = window.setInterval(() => {
      if (track.readyState === "ended") setMicrophone("disconnected");
    }, 1000);
    return () => window.clearInterval(timer);
  }, [stream]);

  // Recover automatically when a device is plugged back in.
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const onChange = () => {
      const s = streamRef.current;
      const broken =
        !s || s.getTracks().some((t) => t.readyState === "ended") || s.getTracks().length === 0;
      if (broken) void start();
    };
    md.addEventListener("devicechange", onChange);
    return () => md.removeEventListener("devicechange", onChange);
  }, [start]);

  useEffect(() => {
    void start();
    return () => {
      invalidate();
      stop();
    };
  }, [start, stop, invalidate]);

  return { camera, microphone, stream, videoRef: setVideo, retry: start };
}

import { useCallback, useEffect, useRef, useState } from "react";
import { CHECK_TIMING } from "@/lib/exam/config";
import {
  cleanDeviceLabel,
  describeMediaError,
  disconnectedState,
  getMediaSupportIssue,
  isDeviceGoneError,
  permissionRequiredState,
} from "@/lib/exam/media";
import {
  registerAudioContext,
  registerStream,
  releaseAudioContext,
  releaseStream,
} from "@/lib/exam/media-registry";
import type { CheckState, ProbeResult } from "@/lib/exam/types";
import { useLatest } from "./use-latest";
import { useMediaDevices } from "./use-media-devices";
import { usePermissionState } from "./use-permission-state";

/** dB range mapped onto the level meter. */
const FLOOR_DB = -60;
const CEIL_DB = -12;
/**
 * Usable input is confirmed once this much signal above the threshold has
 * accumulated. Speech is bursty, so voiced time is summed rather than required
 * to be continuous, and decays slowly during silence.
 */
const VOICE_THRESHOLD_DB = -42;
const VOICED_MS_REQUIRED = 400;
const VOICED_DECAY = 0.1;
/** Below this RMS the device is delivering digital silence (muted / dead input). */
const SILENCE_RMS = 0.0005;
/** Signal but no voice for this long → nudge the candidate. */
const QUIET_HINT_MS = 7000;

const LISTENING: CheckState = { status: "checking", label: "Listening…" };
const WAITING_PERMISSION: CheckState = { status: "checking", label: "Waiting for Permission" };
const PASSED: CheckState = { status: "passed", label: "Working Properly" };
const NO_INPUT: CheckState = {
  status: "failed",
  reason: "no_input",
  label: "No Input",
  message: {
    title: "No sound is reaching your microphone.",
    description:
      "Make sure it isn't muted in your system settings or on your headset, or choose another microphone.",
  },
};

const fail = (reason: string): ProbeResult => ({ ok: false, reason });

interface UseMicrophoneCheckOptions {
  /** Segments in the level meter; level is quantised so React doesn't re-render every frame. */
  segments: number;
}

export function useMicrophoneCheck({ segments }: UseMicrophoneCheckOptions) {
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef(0);
  const attemptRef = useRef(0);
  /** Invalidates any in-flight getUserMedia call so its result is discarded. */
  const invalidate = useCallback(() => {
    attemptRef.current++;
  }, []);

  const permission = usePermissionState("microphone");
  const [state, setState] = useState<CheckState>(LISTENING);
  const [level, setLevel] = useState(0);
  const [deviceLabel, setDeviceLabel] = useState<string | null>(null);
  const [activeDeviceId, setActiveDeviceId] = useState<string | undefined>();
  const [quiet, setQuiet] = useState(false);
  const [needsGesture, setNeedsGesture] = useState(false);
  const { devices, present } = useMediaDevices("audioinput", deviceLabel);

  /** Stops the analysis loop, every track and the AudioContext. */
  const teardown = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    releaseStream(streamRef.current);
    streamRef.current = null;
    releaseAudioContext(ctxRef.current);
    ctxRef.current = null;
  }, []);

  const latest = useLatest({ permission, state, activeDeviceId });

  const start = useCallback(
    async (deviceId?: string) => {
      const attempt = ++attemptRef.current;
      teardown();
      setLevel(0);
      setQuiet(false);
      setNeedsGesture(false);

      const unsupported = getMediaSupportIssue("microphone");
      if (unsupported) {
        setState(unsupported);
        return;
      }
      setState(latest.current.permission === "prompt" ? WAITING_PERMISSION : LISTENING);

      // Raw signal: AGC/noise suppression would hide a too-quiet or noisy mic.
      const open = (id?: string) =>
        navigator.mediaDevices.getUserMedia({
          video: false,
          audio: {
            ...(id ? { deviceId: { exact: id } } : {}),
            echoCancellation: true,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });

      let stream: MediaStream;
      try {
        try {
          stream = await open(deviceId);
        } catch (error) {
          if (deviceId && isDeviceGoneError(error)) stream = await open();
          else throw error;
        }
      } catch (error) {
        if (attempt !== attemptRef.current) return;
        console.warn("[kproctor] microphone start failed", error);
        setState(describeMediaError(error, "microphone", latest.current.permission));
        return;
      }
      if (attempt !== attemptRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      registerStream(stream);
      streamRef.current = stream;
      const [track] = stream.getAudioTracks();
      setDeviceLabel(cleanDeviceLabel(track.label, "Default microphone"));
      setActiveDeviceId(track.getSettings().deviceId ?? deviceId);
      track.addEventListener("ended", () => {
        if (attempt !== attemptRef.current) return;
        teardown();
        setLevel(0);
        setState(
          latest.current.permission === "denied"
            ? permissionRequiredState("microphone")
            : disconnectedState("microphone"),
        );
      });

      let ctx: AudioContext;
      try {
        const AudioCtx =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        ctx = registerAudioContext(new AudioCtx());
      } catch (error) {
        console.warn("[kproctor] AudioContext unavailable", error);
        teardown();
        setState({
          status: "not_available",
          reason: "unsupported",
          label: "Not Supported",
          message: {
            title: "Audio analysis is unavailable in this browser.",
            description: "Use the latest version of Chrome, Edge or Firefox to take this exam.",
          },
        });
        return;
      }
      ctxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.6;
      ctx.createMediaStreamSource(stream).connect(analyser);

      // Browsers may keep the context suspended until the page receives a gesture.
      if (ctx.state === "suspended") {
        await ctx.resume().catch(() => {});
        if (attempt !== attemptRef.current) return;
        setNeedsGesture(ctx.state === "suspended");
      }

      const buffer = new Float32Array(analyser.fftSize);
      let runningSince: number | null = null;
      let lastFrameAt = performance.now();
      let smoothed = 0;
      let lastSegments = -1;
      let voicedMs = 0;
      let peakRms = 0;
      let detected = false;
      let silentReported = false;
      let hinted = false;

      const tick = () => {
        const now = performance.now();
        const dt = now - lastFrameAt;
        lastFrameAt = now;

        // A suspended context yields zeros — don't mistake that for a dead microphone.
        if (ctx.state !== "running") {
          runningSince = null;
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        runningSince ??= now;

        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
        const rms = Math.sqrt(sum / buffer.length);
        peakRms = Math.max(peakRms, rms);
        const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
        const normalized = Math.min(1, Math.max(0, (db - FLOOR_DB) / (CEIL_DB - FLOOR_DB)));
        // Fast attack, slow release — reads like a hardware meter.
        smoothed = normalized > smoothed ? normalized : smoothed * 0.9 + normalized * 0.1;

        const lit = Math.round(smoothed * segments);
        if (lit !== lastSegments) {
          lastSegments = lit;
          setLevel(lit);
        }

        const elapsed = now - runningSince;
        const silent = peakRms < SILENCE_RMS || track.muted;

        if (silent && elapsed > CHECK_TIMING.microphoneNoInputAfter && !silentReported) {
          silentReported = true;
          setState(NO_INPUT);
        } else if (silentReported && !silent) {
          // Input came back (unmuted / plugged in properly).
          silentReported = false;
          setState(detected ? PASSED : LISTENING);
        }
        if (track.muted) peakRms = 0;

        if (!detected && !silentReported) {
          voicedMs =
            db > VOICE_THRESHOLD_DB ? voicedMs + dt : Math.max(0, voicedMs - dt * VOICED_DECAY);
          if (voicedMs >= VOICED_MS_REQUIRED) {
            detected = true;
            setQuiet(false);
            setState(PASSED);
          } else if (!hinted && elapsed > QUIET_HINT_MS) {
            hinted = true;
            setQuiet(true);
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    },
    [segments, teardown, latest],
  );

  // Resume a gesture-locked AudioContext on the first interaction anywhere on the page.
  useEffect(() => {
    if (!needsGesture) return;
    const resume = () => {
      void ctxRef.current?.resume().then(() => setNeedsGesture(false));
    };
    window.addEventListener("pointerdown", resume, { once: true });
    window.addEventListener("keydown", resume, { once: true });
    return () => {
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
    };
  }, [needsGesture]);

  // Permission granted (e.g. from browser settings) → retry; revoked → stop and explain.
  useEffect(() => {
    const { state: current, activeDeviceId: deviceId } = latest.current;
    const waitingOnPermission =
      current.reason === "permission_required" || current.reason === "permission_prompt";
    if (permission === "granted" && waitingOnPermission) void start(deviceId);
    if (permission === "denied" && current.reason !== "permission_required") {
      invalidate();
      teardown();
      setLevel(0);
      setState(permissionRequiredState("microphone"));
    }
  }, [permission, start, teardown, latest, invalidate]);

  // Microphone reconnected after "no device" / "disconnected" → restart automatically.
  // Only fires when a device appears, so a still-missing device can't cause a retry loop.
  const reason = state.reason;
  const prevPresentRef = useRef(present);
  useEffect(() => {
    const appeared = present === true && prevPresentRef.current === false;
    prevPresentRef.current = present;
    if (appeared && (reason === "no_device" || reason === "disconnected")) void start();
  }, [present, reason, start]);

  useEffect(() => {
    void start();
    const onPageHide = () => {
      invalidate();
      teardown();
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      invalidate();
      teardown();
    };
  }, [start, teardown, invalidate]);

  const probe = useCallback((): ProbeResult => {
    const track = streamRef.current?.getAudioTracks()[0];
    if (!track || track.readyState !== "live") return fail("Microphone is not active.");
    if (track.muted) return fail("Microphone is muted.");
    if (ctxRef.current?.state !== "running") return fail("Microphone analysis is paused.");
    return { ok: true };
  }, []);

  const retry = useCallback(() => start(activeDeviceId), [start, activeDeviceId]);

  return {
    state,
    level,
    deviceLabel,
    devices,
    activeDeviceId,
    quiet,
    needsGesture,
    retry,
    selectDevice: start,
    probe,
  };
}

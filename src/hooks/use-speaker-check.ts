import { useCallback, useEffect, useRef, useState } from "react";
import { registerAudioContext, releaseAudioContext } from "@/lib/exam/media-registry";
import { playTestChime } from "@/lib/exam/test-sound";
import type { CheckState, ProbeResult } from "@/lib/exam/types";
import { useLatest } from "./use-latest";

export type SpeakerPhase = "idle" | "playing" | "confirming" | "passed" | "not_heard";

const NOT_TESTED: CheckState = { status: "idle", label: "Not Tested" };
const NOT_HEARD: CheckState = {
  status: "failed",
  reason: "not_heard",
  label: "Not Heard",
  message: {
    title: "You couldn't hear the test sound.",
    description: "Unmute your device, raise the volume or plug in headphones, then play it again.",
  },
};
const RETEST: CheckState = {
  status: "idle",
  reason: "retest_needed",
  label: "Retest Needed",
  message: {
    title: "Your audio output changed.",
    description: "Play the test sound again to confirm you can hear it.",
  },
};

/** Perceptual volume curve: slider position (0–1) → linear gain. */
const toGain = (volume: number) => volume * volume;

async function outputDeviceIds(): Promise<string> {
  try {
    const all = await navigator.mediaDevices?.enumerateDevices();
    return (all ?? [])
      .filter((d) => d.kind === "audiooutput")
      .map((d) => d.deviceId)
      .sort()
      .join("|");
  } catch {
    return "";
  }
}

/**
 * Speaker test: plays a browser-generated chime and requires the candidate to
 * confirm they heard it. It never passes on its own.
 */
export function useSpeakerCheck(initialVolume = 0.7) {
  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const timerRef = useRef(0);

  const [state, setState] = useState<CheckState>(NOT_TESTED);
  const [phase, setPhase] = useState<SpeakerPhase>("idle");
  const [volume, setVolumeState] = useState(initialVolume);
  const phaseRef = useLatest(phase);

  const setVolume = useCallback((v: number) => {
    setVolumeState(v);
    const gain = gainRef.current;
    if (gain) gain.gain.setTargetAtTime(toGain(v), gain.context.currentTime, 0.02);
  }, []);

  /** Must be called from a user gesture so the AudioContext is allowed to start. */
  const play = useCallback(async () => {
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) {
      setState({
        status: "not_available",
        reason: "unsupported",
        label: "Not Supported",
        message: {
          title: "Audio playback is unavailable in this browser.",
          description: "Use the latest version of Chrome, Edge or Firefox to take this exam.",
        },
      });
      return;
    }

    if (!ctxRef.current || ctxRef.current.state === "closed") {
      const ctx = registerAudioContext(new AudioCtx());
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      ctxRef.current = ctx;
      gainRef.current = gain;
    }
    const ctx = ctxRef.current;
    const gain = gainRef.current!;
    await ctx.resume().catch(() => {});
    gain.gain.setValueAtTime(toGain(volume), ctx.currentTime);

    window.clearTimeout(timerRef.current);
    setPhase("playing");
    setState({ status: "checking", label: "Playing…" });

    const seconds = playTestChime(ctx, gain);
    timerRef.current = window.setTimeout(() => {
      setPhase("confirming");
      setState({ status: "idle", label: "Awaiting Answer" });
    }, seconds * 1000);
  }, [volume]);

  const confirm = useCallback((heard: boolean) => {
    setPhase(heard ? "passed" : "not_heard");
    setState(heard ? { status: "passed", label: "Working Properly" } : NOT_HEARD);
  }, []);

  // If the audio output changes (headphones unplugged, new device), the old answer no longer holds.
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    let baseline: string | null = null;
    void outputDeviceIds().then((ids) => (baseline = ids));
    const onChange = async () => {
      const ids = await outputDeviceIds();
      if (baseline !== null && ids !== baseline && phaseRef.current === "passed") {
        setPhase("idle");
        setState(RETEST);
      }
      baseline = ids;
    };
    md.addEventListener("devicechange", onChange);
    return () => md.removeEventListener("devicechange", onChange);
  }, [phaseRef]);

  useEffect(() => {
    const close = () => {
      window.clearTimeout(timerRef.current);
      releaseAudioContext(ctxRef.current);
      ctxRef.current = null;
      gainRef.current = null;
    };
    window.addEventListener("pagehide", close);
    return () => {
      window.removeEventListener("pagehide", close);
      close();
    };
  }, []);

  const probe = useCallback(
    (): ProbeResult =>
      phaseRef.current === "passed"
        ? { ok: true }
        : { ok: false, reason: "Speaker test hasn't been confirmed." },
    [phaseRef],
  );

  return { state, phase, volume, setVolume, play, confirm, probe };
}

import { useEffect, useRef, useState } from "react";
import { Expand, Mic, MicOff, RefreshCw, Video, VideoOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DeviceStatus } from "@/hooks/use-exam-monitoring";
import { cn } from "@/lib/utils";

const MESSAGE: Partial<Record<DeviceStatus, { title: string; text: string; retry: boolean }>> = {
  starting: {
    title: "Starting camera…",
    text: "Waiting for video from your camera.",
    retry: false,
  },
  stalled: {
    title: "No video from your camera",
    text: "Check the privacy shutter or close other apps using the camera.",
    retry: true,
  },
  disconnected: {
    title: "Camera disconnected",
    text: "Reconnect your camera. This has been recorded for the exam.",
    retry: true,
  },
  blocked: {
    title: "Camera permission is blocked",
    text: "Allow camera access in your browser's site settings, then reconnect.",
    retry: true,
  },
  unavailable: {
    title: "No camera available",
    text: "Connect a camera, then reconnect.",
    retry: true,
  },
};

interface LiveCameraFeedProps {
  camera: DeviceStatus;
  microphone: DeviceStatus;
  stream: MediaStream | null;
  /** Receives the preview element; the monitoring hook attaches the stream and watches frames. */
  videoRef: (el: HTMLVideoElement | null) => void;
  onRetry: () => void;
}

/** The candidate's real camera stream. Nothing is recorded or uploaded from here. */
export function LiveCameraFeed({
  camera,
  microphone,
  stream,
  videoRef,
  onRetry,
}: LiveCameraFeedProps) {
  const [expanded, setExpanded] = useState(false);
  const live = camera === "live";
  const message = MESSAGE[camera];

  return (
    <section
      aria-labelledby="camera-feed-heading"
      className="shrink-0 rounded-2xl border border-slate-200/70 bg-white p-3.5 shadow-sm"
    >
      <div className="flex items-center justify-between">
        <h2 id="camera-feed-heading" className="text-sm font-bold text-navy">
          Live Camera Feed
        </h2>
        {live ? (
          <span
            data-camera-live
            className="flex items-center gap-1.5 text-[11px] font-extrabold text-brand-strong"
          >
            <span className="h-2 w-2 animate-pulse rounded-full bg-brand" aria-hidden />
            LIVE
          </span>
        ) : camera !== "not_required" ? (
          <span className="text-[11px] font-bold text-slate-500">Not live</span>
        ) : null}
      </div>

      {camera === "not_required" ? (
        <p className="mt-3 rounded-xl bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
          This exam doesn't require a camera.
        </p>
      ) : (
        <div className="relative mt-2.5 aspect-video overflow-hidden rounded-xl bg-navy short:aspect-[2/1]">
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            aria-label="Your camera preview"
            data-camera-status={camera}
            className={cn("h-full w-full -scale-x-100 object-cover", !live && "opacity-30")}
          />
          {message && (
            <div
              role="status"
              className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-6 text-center text-white"
            >
              <VideoOff className="h-6 w-6 text-white/80" aria-hidden />
              <p className="text-[13px] font-bold">{message.title}</p>
              <p className="text-[11px] text-white/75">{message.text}</p>
              {message.retry && (
                <Button
                  size="sm"
                  onClick={onRetry}
                  className="mt-1.5 h-8 rounded-lg bg-white px-3 text-xs font-bold text-navy hover:bg-white/90"
                >
                  <RefreshCw aria-hidden />
                  Reconnect
                </Button>
              )}
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/60 to-transparent px-3 pb-2 pt-6 text-white">
            <div className="flex items-center gap-3">
              {microphone === "live" ? (
                <Mic className="h-4 w-4" aria-label="Microphone on" />
              ) : microphone !== "not_required" ? (
                <MicOff className="h-4 w-4 text-red-300" aria-label="Microphone not working" />
              ) : null}
              {live ? (
                <Video className="h-4 w-4" aria-label="Camera on" />
              ) : (
                <VideoOff className="h-4 w-4 text-red-300" aria-label="Camera not live" />
              )}
            </div>
            {live && (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                aria-label="Enlarge camera preview"
                className="grid h-7 w-7 place-items-center rounded-md bg-black/40 hover:bg-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                <Expand className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </div>
        </div>
      )}

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="kp max-w-3xl rounded-2xl bg-white p-4">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-navy">Camera preview</DialogTitle>
            <DialogDescription className="text-xs text-slate-600">
              This is what your camera shows. It isn't recorded.
            </DialogDescription>
          </DialogHeader>
          <ExpandedPreview stream={stream} />
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ExpandedPreview({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true;
    v.srcObject = stream;
    if (stream) void v.play().catch(() => undefined);
    return () => {
      v.srcObject = null;
    };
  }, [stream]);
  return (
    <video
      ref={ref}
      muted
      playsInline
      autoPlay
      className="aspect-video w-full -scale-x-100 rounded-xl bg-navy object-cover"
    />
  );
}

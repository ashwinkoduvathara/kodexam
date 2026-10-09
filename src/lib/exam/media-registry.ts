/**
 * Tracks every capture stream and AudioContext opened by the System Check so
 * they can be released together — on unmount, route change and page unload.
 * Nothing is recorded or uploaded; this only exists to guarantee cleanup.
 */

const streams = new Set<MediaStream>();
const contexts = new Set<AudioContext>();

export function registerStream(stream: MediaStream): MediaStream {
  streams.add(stream);
  return stream;
}

export function releaseStream(stream: MediaStream | null | undefined) {
  if (!stream) return;
  stream.getTracks().forEach((track) => track.stop());
  streams.delete(stream);
}

export function registerAudioContext(ctx: AudioContext): AudioContext {
  contexts.add(ctx);
  return ctx;
}

export function releaseAudioContext(ctx: AudioContext | null | undefined) {
  if (!ctx) return;
  contexts.delete(ctx);
  if (ctx.state !== "closed") void ctx.close().catch(() => {});
}

/** Stops every camera/microphone track and closes every AudioContext. */
export function releaseAllMedia() {
  streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  streams.clear();
  contexts.forEach((c) => {
    if (c.state !== "closed") void c.close().catch(() => {});
  });
  contexts.clear();
}

export function activeMediaCount() {
  return { streams: streams.size, audioContexts: contexts.size };
}

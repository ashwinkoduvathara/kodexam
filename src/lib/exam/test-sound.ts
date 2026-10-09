/**
 * Synthesises a short, pleasant three-note chime with the Web Audio API so the
 * speaker test needs no audio asset and works offline.
 *
 * Returns the playback duration in seconds.
 */
export function playTestChime(ctx: AudioContext, destination: AudioNode): number {
  const notes = [659.25, 783.99, 1046.5]; // E5, G5, C6
  const step = 0.18;
  const noteLength = 0.55;
  const now = ctx.currentTime + 0.05;

  // Play the arpeggio twice so the candidate has time to notice it.
  const repeats = 2;
  const gap = 0.35;
  const cycle = step * notes.length + gap;

  for (let r = 0; r < repeats; r++) {
    notes.forEach((freq, i) => {
      const start = now + r * cycle + i * step;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, start);
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(0.35, start + 0.015);
      env.gain.exponentialRampToValueAtTime(0.0001, start + noteLength);
      osc.connect(env).connect(destination);
      osc.start(start);
      osc.stop(start + noteLength + 0.05);
    });
  }

  return 0.05 + (repeats - 1) * cycle + (notes.length - 1) * step + noteLength;
}

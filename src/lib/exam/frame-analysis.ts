/**
 * Lightweight, on-device webcam frame checks shown under the camera preview.
 *
 * - Lighting is measured directly from frame luminance (works in every browser).
 * - Face checks use a pluggable `FaceDetectionProvider`. The default uses the
 *   browser Shape Detection API (`FaceDetector`) where available; elsewhere the
 *   face signals stay "unknown" and are enforced later by Identity Verification.
 *   Swap in an ML provider (e.g. MediaPipe) by implementing the interface.
 */

export type FrameSignal = "pass" | "fail" | "unknown";

export interface FrameQuality {
  lighting: FrameSignal;
  faceInFrame: FrameSignal;
  faceVisible: FrameSignal;
}

export const UNKNOWN_FRAME_QUALITY: FrameQuality = {
  lighting: "unknown",
  faceInFrame: "unknown",
  faceVisible: "unknown",
};

export interface DetectedFace {
  box: { x: number; y: number; width: number; height: number };
}

export interface FaceDetectionProvider {
  detect(video: HTMLVideoElement): Promise<DetectedFace[]>;
}

// Minimal typing for the (Chromium-only) Shape Detection API.
interface NativeFaceDetector {
  detect(source: CanvasImageSource): Promise<Array<{ boundingBox: DOMRectReadOnly }>>;
}
type NativeFaceDetectorCtor = new (options?: {
  fastMode?: boolean;
  maxDetectedFaces?: number;
}) => NativeFaceDetector;

export function createNativeFaceDetector(): FaceDetectionProvider | null {
  const Ctor = (globalThis as { FaceDetector?: NativeFaceDetectorCtor }).FaceDetector;
  if (!Ctor) return null;
  let detector: NativeFaceDetector;
  try {
    detector = new Ctor({ fastMode: true, maxDetectedFaces: 3 });
  } catch {
    return null;
  }
  return {
    async detect(video) {
      const faces = await detector.detect(video);
      return faces.map((f) => ({
        box: {
          x: f.boundingBox.x,
          y: f.boundingBox.y,
          width: f.boundingBox.width,
          height: f.boundingBox.height,
        },
      }));
    },
  };
}

const SAMPLE_W = 64;
const SAMPLE_H = 36;

/** Average luma (0–255) of a downscaled frame. */
export function measureBrightness(video: HTMLVideoElement, canvas: HTMLCanvasElement): number {
  canvas.width = SAMPLE_W;
  canvas.height = SAMPLE_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return -1;
  ctx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
  const { data } = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H);
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  }
  return sum / (data.length / 4);
}

export function lightingSignal(luma: number): FrameSignal {
  if (luma < 0) return "unknown";
  return luma >= 55 && luma <= 225 ? "pass" : "fail";
}

export function faceSignals(
  faces: DetectedFace[],
  frameW: number,
  frameH: number,
): Omit<FrameQuality, "lighting"> {
  if (faces.length !== 1) return { faceInFrame: "fail", faceVisible: "fail" };
  const { box } = faces[0];
  const margin = 0.02;
  const inFrame =
    box.x >= frameW * margin &&
    box.y >= frameH * margin &&
    box.x + box.width <= frameW * (1 - margin) &&
    box.y + box.height <= frameH * (1 - margin);
  const visible = (box.width * box.height) / (frameW * frameH) >= 0.04;
  return { faceInFrame: inFrame ? "pass" : "fail", faceVisible: visible ? "pass" : "fail" };
}

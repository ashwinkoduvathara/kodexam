/**
 * Framework-free Fullscreen API wrapper with vendor-prefix fallbacks
 * (Safari < 16.4 only exposes the webkit-prefixed API).
 * Used by `useFullscreen`; enforced from the Start Exam step, not System Check.
 */

type PrefixedDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type PrefixedElement = HTMLElement & {
  webkitRequestFullscreen?: (options?: FullscreenOptions) => Promise<void> | void;
};

const doc = () => document as PrefixedDocument;

export function isFullscreenSupported(): boolean {
  if (typeof document === "undefined") return false;
  return Boolean(doc().fullscreenEnabled ?? doc().webkitFullscreenEnabled);
}

export function getFullscreenElement(): Element | null {
  if (typeof document === "undefined") return null;
  return doc().fullscreenElement ?? doc().webkitFullscreenElement ?? null;
}

export function isFullscreenActive(): boolean {
  return getFullscreenElement() !== null;
}

/** Must be called from a user gesture. Resolves false when the browser refuses. */
export async function enterFullscreen(
  element: HTMLElement = document.documentElement,
): Promise<boolean> {
  if (!isFullscreenSupported()) return false;
  if (isFullscreenActive()) return true;
  const el = element as PrefixedElement;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: "hide" });
    else await el.webkitRequestFullscreen?.();
    return isFullscreenActive();
  } catch {
    return false;
  }
}

export async function exitFullscreen(): Promise<void> {
  if (!isFullscreenActive()) return;
  try {
    if (document.exitFullscreen) await document.exitFullscreen();
    else await doc().webkitExitFullscreen?.();
  } catch {
    /* already exited */
  }
}

export function onFullscreenChange(listener: () => void): () => void {
  document.addEventListener("fullscreenchange", listener);
  document.addEventListener("webkitfullscreenchange", listener);
  return () => {
    document.removeEventListener("fullscreenchange", listener);
    document.removeEventListener("webkitfullscreenchange", listener);
  };
}

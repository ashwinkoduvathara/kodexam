import { useCallback, useEffect, useState } from "react";
import {
  enterFullscreen,
  exitFullscreen,
  isFullscreenActive,
  isFullscreenSupported,
  onFullscreenChange,
} from "@/lib/exam/fullscreen";
import type { CheckState } from "@/lib/exam/types";

/**
 * Fullscreen state + controls. Not enforced on System Check; the Start Exam step
 * will require it via `fullscreenCheckState()` and use `exitCount` to flag exits.
 */
export function useFullscreen() {
  const [isSupported, setIsSupported] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [exitCount, setExitCount] = useState(0);

  useEffect(() => {
    setIsSupported(isFullscreenSupported());
    setIsFullscreen(isFullscreenActive());
    let wasActive = isFullscreenActive();
    return onFullscreenChange(() => {
      const active = isFullscreenActive();
      setIsFullscreen(active);
      if (wasActive && !active) setExitCount((n) => n + 1);
      wasActive = active;
    });
  }, []);

  const enter = useCallback((element?: HTMLElement) => enterFullscreen(element), []);
  const exit = useCallback(() => exitFullscreen(), []);

  return { isSupported, isFullscreen, exitCount, enter, exit };
}

export function fullscreenCheckState(isSupported: boolean, isFullscreen: boolean): CheckState {
  if (!isSupported) {
    return {
      status: "not_available",
      reason: "unsupported",
      label: "Not Supported",
      message: {
        title: "Fullscreen isn't available in this browser.",
        description: "Use the latest version of Chrome, Edge or Firefox to take this exam.",
      },
    };
  }
  return isFullscreen
    ? { status: "passed", label: "Fullscreen On" }
    : {
        status: "failed",
        reason: "permission_required",
        label: "Fullscreen Required",
        message: {
          title: "The exam must run in fullscreen.",
          description: "Select Enter Fullscreen to continue.",
        },
      };
}

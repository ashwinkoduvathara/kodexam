import { useCallback, useEffect, useState } from "react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useSystemReadiness } from "@/hooks/use-system-readiness";
import { releaseAllMedia } from "@/lib/exam/media-registry";
import type { NetworkTester } from "@/lib/exam/network-test";
import type { SystemCheckSummary } from "@/lib/exam/session/exam-session-service";
import type { ExamSession, SystemCheckId } from "@/lib/exam/types";
import { cn } from "@/lib/utils";
import { EXAM_DESKTOP_QUERY } from "../DesktopOnlyGate";
import { CameraCheck } from "./CameraCheck";
import { CheckInfoBanner } from "./CheckInfoBanner";
import { ExamTips } from "./ExamTips";
import { MicrophoneCheck } from "./MicrophoneCheck";
import { NetworkCheck } from "./NetworkCheck";
import { ReadinessPanel } from "./ReadinessPanel";
import { SecurityBanner } from "./SecurityBanner";
import { SessionExpiredNotice } from "./SessionExpiredNotice";
import { SpeakerCheck } from "./SpeakerCheck";
import { StatusAnnouncer } from "./StatusAnnouncer";

const GRID_COLUMNS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-2 xl:grid-cols-4",
};

interface SystemCheckProps {
  session: ExamSession;
  sessionExpired: boolean;
  /** Called after the final readiness validation succeeds. Must persist the result. */
  onContinue: (summary: SystemCheckSummary) => Promise<void>;
  onReadyChange?: (ready: boolean) => void;
  networkTester?: NetworkTester;
}

export function SystemCheck({
  session,
  sessionExpired,
  onContinue,
  onReadyChange,
  networkTester,
}: SystemCheckProps) {
  const { requiredChecks } = session;
  const { states, reporter, allRequiredChecksPassed, canContinue, validation, validate } =
    useSystemReadiness({ requiredChecks, sessionExpired });
  const [completed, setCompleted] = useState(false);

  // Hardware checks only start on a real desktop viewport, never during SSR.
  const isDesktop = useMediaQuery(EXAM_DESKTOP_QUERY, false);
  const runChecks = isDesktop && !sessionExpired;

  useEffect(() => onReadyChange?.(canContinue), [canContinue, onReadyChange]);

  // Belt and braces: whatever the checks left open is released when the session expires.
  useEffect(() => {
    if (sessionExpired) releaseAllMedia();
  }, [sessionExpired]);

  const handleContinue = useCallback(async () => {
    // Final authority: re-probe the real devices, not just the reported state.
    const result = await validate();
    if (!result.ok) return;
    try {
      await onContinue({
        completedAt: new Date().toISOString(),
        results: Object.fromEntries(requiredChecks.map((id) => [id, states[id].status])),
      });
      setCompleted(true);
    } catch {
      /* the route reports the failure; the candidate can press Continue again */
    }
  }, [validate, onContinue, requiredChecks, states]);

  const has = (id: SystemCheckId) => requiredChecks.includes(id);

  return (
    <div className="mx-auto flex max-w-[1320px] flex-col gap-5 px-6 py-6 min-[1400px]:px-8 short:gap-3 short:py-3.5">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-[28px] font-extrabold leading-tight tracking-tight text-navy short:text-2xl">
            System Check
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Let's make sure everything is working properly before your exam.
          </p>
        </div>
        <SecurityBanner />
      </div>

      {sessionExpired ? (
        <SessionExpiredNotice session={session} />
      ) : (
        <>
          <CheckInfoBanner />

          <div
            id="system-checks"
            className={cn("grid gap-3 min-[1400px]:gap-4", GRID_COLUMNS[requiredChecks.length])}
          >
            {runChecks ? (
              <>
                {has("camera") && <CameraCheck reporter={reporter} />}
                {has("microphone") && <MicrophoneCheck reporter={reporter} />}
                {has("speaker") && <SpeakerCheck reporter={reporter} />}
                {has("network") && <NetworkCheck reporter={reporter} tester={networkTester} />}
              </>
            ) : (
              requiredChecks.map((id) => <CheckCardSkeleton key={id} />)
            )}
          </div>

          <div className="flex items-stretch gap-3 min-[1400px]:gap-4">
            <div className="min-w-0 flex-1">
              <ExamTips />
            </div>
            <ReadinessPanel
              requiredChecks={requiredChecks}
              states={states}
              allRequiredChecksPassed={allRequiredChecksPassed}
              canContinue={canContinue}
              validation={validation}
              completed={completed}
              onContinue={handleContinue}
            />
          </div>
          <StatusAnnouncer requiredChecks={requiredChecks} states={states} />
        </>
      )}
    </div>
  );
}

function CheckCardSkeleton() {
  return (
    <div
      aria-hidden
      className="flex h-[380px] flex-col rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm"
    >
      <div className="flex justify-between">
        <span className="h-10 w-10 animate-pulse rounded-xl bg-slate-100" />
        <span className="h-5 w-24 animate-pulse rounded-full bg-slate-100" />
      </div>
      <span className="mt-3 h-4 w-24 animate-pulse rounded bg-slate-100" />
      <span className="mt-2 h-3 w-40 animate-pulse rounded bg-slate-100" />
      <span className="mt-3 flex-1 animate-pulse rounded-xl bg-slate-50" />
      <span className="mt-3 h-10 animate-pulse rounded-xl bg-slate-100" />
    </div>
  );
}

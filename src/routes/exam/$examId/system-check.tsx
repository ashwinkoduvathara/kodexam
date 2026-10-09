import { useCallback } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import toast from "react-hot-toast";
import { useExamFlow } from "@/components/exam/exam-flow-context";
import { SystemCheck } from "@/components/exam/system-check/SystemCheck";
import { releaseAllMedia } from "@/lib/exam/media-registry";
import {
  getExamSessionService,
  type SystemCheckSummary,
} from "@/lib/exam/session/exam-session-service";
import { routeForStatus } from "@/lib/exam/steps";

export const Route = createFileRoute("/exam/$examId/system-check")({
  staticData: { examStep: "system-check" },
  head: () => ({ meta: [{ title: "System Check · KProctor" }] }),
  // Never leave the webcam or microphone running after navigating away.
  onLeave: () => releaseAllMedia(),
  component: SystemCheckPage,
});

function SystemCheckPage() {
  const { examId } = Route.useParams();
  const navigate = useNavigate();
  const { session, expired, setStepReady, applySession } = useExamFlow();

  const handleReadyChange = useCallback(
    (ready: boolean) => setStepReady("system-check", ready),
    [setStepReady],
  );

  const handleContinue = useCallback(
    async (summary: SystemCheckSummary) => {
      let updated;
      try {
        updated = await getExamSessionService().submitSystemCheck(session.attemptId, summary);
      } catch (error) {
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : "We couldn't save your system check. Check your connection and try again.",
        );
        throw error;
      }
      applySession(updated);
      await navigate({ to: routeForStatus(updated.attemptStatus), params: { examId } });
    },
    [session.attemptId, applySession, navigate, examId],
  );

  return (
    <SystemCheck
      session={session}
      sessionExpired={expired}
      onReadyChange={handleReadyChange}
      onContinue={handleContinue}
    />
  );
}

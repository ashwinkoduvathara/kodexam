import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, Navigate, Outlet, useMatches } from "@tanstack/react-router";
import { ExamLayout } from "@/components/exam/ExamLayout";
import { ExamFlowContext, type ExamFlowContextValue } from "@/components/exam/exam-flow-context";
import {
  AttemptClosedNotice,
  ExamLoadingState,
  ExamSessionErrorState,
} from "@/components/exam/ExamSessionStates";
import { useExamClock } from "@/hooks/use-exam-clock";
import { getExamSessionService } from "@/lib/exam/session/exam-session-service";
import { completedStepsFrom } from "@/lib/exam/steps";
import type { ExamSession, ExamStepId } from "@/lib/exam/types";
import { ATTEMPT_STATUS, isTerminalStatus } from "@/types/exam-attempt";

export const Route = createFileRoute("/exam/$examId")({
  // Exam pages render in the browser only: the session is fetched with the
  // candidate's HttpOnly cookie through ExamSessionService → API → MongoDB.
  ssr: false,
  loader: ({ params }) => getExamSessionService().openSession(params.examId),
  // The session (and its server-issued deadline) isn't refetched between steps;
  // a browser refresh always re-reads it from the server.
  staleTime: Infinity,
  pendingComponent: ExamLoadingState,
  errorComponent: ExamSessionErrorState,
  component: ExamRouteLayout,
});

function ExamRouteLayout() {
  const { examId } = Route.useParams();
  const loaded = Route.useLoaderData();
  const [session, setSession] = useState<ExamSession>(loaded);
  useEffect(() => setSession(loaded), [loaded]);

  const matches = useMatches();
  const currentStep: ExamStepId =
    [...matches].reverse().find((m) => m.staticData?.examStep)?.staticData.examStep ??
    "system-check";

  const { remainingSeconds, expired } = useExamClock(session.examEndTime);

  const [readySteps, setReadySteps] = useState<Partial<Record<ExamStepId, boolean>>>({});
  const setStepReady = useCallback((step: ExamStepId, ready: boolean) => {
    setReadySteps((prev) => (prev[step] === ready ? prev : { ...prev, [step]: ready }));
  }, []);

  const refreshSession = useCallback(async () => {
    setSession(await getExamSessionService().getSession(examId));
  }, [examId]);

  // remainingSeconds is intentionally not in context, so step screens don't re-render every tick.
  const flow = useMemo<ExamFlowContextValue>(
    () => ({ session, expired, setStepReady, applySession: setSession, refreshSession }),
    [session, expired, setStepReady, refreshSession],
  );

  // Before the exam starts, End Exam cancels the attempt; once it's running, it submits.
  const running = session.attemptStatus === ATTEMPT_STATUS.IN_PROGRESS;
  const endExam = useCallback(async () => {
    const svc = getExamSessionService();
    const result = running
      ? await svc.submitExam(session.attemptId)
      : await svc.endExamAttempt(session.attemptId);
    if (result.ok) setSession(result.session);
    return result;
  }, [session.attemptId, running]);

  const handleExamEnded = useCallback(() => {
    const lmsUrl = import.meta.env.VITE_LMS_URL as string | undefined;
    if (lmsUrl) window.location.assign(lmsUrl);
  }, []);

  const completedSteps = useMemo(() => completedStepsFrom(session), [session]);
  const onActiveRoute = matches.some((m) => m.routeId === "/exam/$examId/active");
  const examRunning = session.attemptStatus === ATTEMPT_STATUS.IN_PROGRESS;

  return (
    <ExamFlowContext.Provider value={flow}>
      <ExamLayout
        session={session}
        remainingSeconds={remainingSeconds}
        currentStep={currentStep}
        currentStepReady={Boolean(readySteps[currentStep])}
        completedSteps={completedSteps}
        onEndExam={endExam}
        onExamEnded={handleExamEnded}
        variant={onActiveRoute ? "exam" : "steps"}
      >
        {isTerminalStatus(session.attemptStatus) ? (
          <AttemptClosedNotice session={session} />
        ) : examRunning && !onActiveRoute ? (
          <Navigate to="/exam/$examId/active" params={{ examId }} replace />
        ) : (
          <Outlet />
        )}
      </ExamLayout>
    </ExamFlowContext.Provider>
  );
}

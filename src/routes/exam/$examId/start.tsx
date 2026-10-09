import { useCallback } from "react";
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useExamFlow } from "@/components/exam/exam-flow-context";
import { StartExam } from "@/components/exam/start/StartExam";
import { getExamSessionService } from "@/lib/exam/session/exam-session-service";
import { routeForStatus, stepForStatus } from "@/lib/exam/steps";

/** Screen 4 — Start Exam. The exam timer starts only when the server confirms the start. */
export const Route = createFileRoute("/exam/$examId/start")({
  staticData: { examStep: "start" },
  head: () => ({ meta: [{ title: "Start Exam · KProctor" }] }),
  component: StartExamPage,
});

function StartExamPage() {
  const { examId } = Route.useParams();
  const navigate = useNavigate();
  const { session, expired, applySession, refreshSession } = useExamFlow();

  const handleStart = useCallback(async () => {
    // The server validates every start condition and returns the authoritative deadline.
    const updated = await getExamSessionService().startExam(session.attemptId);
    applySession(updated);
    await navigate({ to: routeForStatus(updated.attemptStatus), params: { examId } });
  }, [session.attemptId, applySession, navigate, examId]);

  // Back to the previous step: Identity Verification, or the instructions when the
  // exam doesn't require identity verification.
  const identityRequired = session.proctoringPolicy.identityVerificationRequired;
  const handleBack = useCallback(() => {
    void navigate({
      to: identityRequired ? "/exam/$examId/identity-verification" : "/exam/$examId/instructions",
      params: { examId },
      search: { revisit: true },
    });
  }, [navigate, examId, identityRequired]);

  // Not ready yet, or already started (e.g. after a refresh): the server's status decides.
  if (stepForStatus(session.attemptStatus) !== "start") {
    return <Navigate to={routeForStatus(session.attemptStatus)} params={{ examId }} replace />;
  }

  return (
    <StartExam
      session={session}
      expired={expired}
      onStart={handleStart}
      onReconcile={refreshSession}
      onBack={handleBack}
      backLabel={identityRequired ? "Back to Identity Verification" : "Back to Exam Instructions"}
    />
  );
}

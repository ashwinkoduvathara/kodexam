import { useCallback } from "react";
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useExamFlow } from "@/components/exam/exam-flow-context";
import { ExamInstructions } from "@/components/exam/instructions/ExamInstructions";
import { getExamSessionService } from "@/lib/exam/session/exam-session-service";
import { routeForStatus, stepForStatus } from "@/lib/exam/steps";

interface InstructionsSearch {
  /** Set by "Back to Exam Instructions" on Screen 3: show read-only instead of forwarding. */
  revisit?: boolean;
}

export const Route = createFileRoute("/exam/$examId/instructions")({
  validateSearch: (search: Record<string, unknown>): InstructionsSearch =>
    search.revisit === true || search.revisit === "true" ? { revisit: true } : {},
  staticData: { examStep: "instructions" },
  head: () => ({ meta: [{ title: "Exam Instructions · KProctor" }] }),
  component: InstructionsPage,
});

function InstructionsPage() {
  const { examId } = Route.useParams();
  const { revisit } = Route.useSearch();
  const navigate = useNavigate();
  const { session, expired, applySession } = useExamFlow();

  const handleAcknowledge = useCallback(async () => {
    // The server validates ownership, expiry and status, then returns the updated session.
    const updated = await getExamSessionService().acknowledgeInstructions(session.attemptId);
    applySession(updated);
    await navigate({ to: routeForStatus(updated.attemptStatus), params: { examId } });
  }, [session.attemptId, applySession, navigate, examId]);

  const handleBack = useCallback(() => {
    void navigate({ to: "/exam/$examId/system-check", params: { examId } });
  }, [navigate, examId]);

  const step = stepForStatus(session.attemptStatus);
  const alreadyAcknowledged = step !== "system-check" && step !== "instructions";

  // Already acknowledged (e.g. after a refresh) → the server has moved the attempt forward,
  // unless the candidate deliberately came back to re-read the instructions.
  if (alreadyAcknowledged && !revisit) {
    return <Navigate to={routeForStatus(session.attemptStatus)} params={{ examId }} replace />;
  }

  return (
    <ExamInstructions
      session={session}
      expired={expired}
      onAcknowledge={handleAcknowledge}
      onBack={handleBack}
      readOnly={
        alreadyAcknowledged
          ? {
              onContinue: () =>
                void navigate({ to: routeForStatus(session.attemptStatus), params: { examId } }),
            }
          : undefined
      }
    />
  );
}

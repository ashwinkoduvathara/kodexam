import { useCallback } from "react";
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useExamFlow } from "@/components/exam/exam-flow-context";
import { IdentityVerification } from "@/components/exam/identity/IdentityVerification";
import { releaseAllMedia } from "@/lib/exam/media-registry";
import { getExamSessionService } from "@/lib/exam/session/exam-session-service";
import { routeForStatus, stepForStatus } from "@/lib/exam/steps";

interface IdentitySearch {
  /** Set by "Back to Identity Verification" on Screen 4: show the completed step, don't forward. */
  revisit?: boolean;
}

export const Route = createFileRoute("/exam/$examId/identity-verification")({
  validateSearch: (search: Record<string, unknown>): IdentitySearch =>
    search.revisit === true || search.revisit === "true" ? { revisit: true } : {},
  staticData: { examStep: "identity" },
  head: () => ({ meta: [{ title: "Identity Verification · KProctor" }] }),
  // The camera must never keep running after leaving this step.
  onLeave: () => releaseAllMedia(),
  component: IdentityVerificationPage,
});

function IdentityVerificationPage() {
  const { examId } = Route.useParams();
  const { revisit } = Route.useSearch();
  const navigate = useNavigate();
  const { session, expired, applySession } = useExamFlow();

  const handleProceed = useCallback(async () => {
    // Re-read the attempt: only the server can move it to READY.
    const updated = await getExamSessionService().getSession(examId);
    applySession(updated);
    await navigate({ to: routeForStatus(updated.attemptStatus), params: { examId } });
  }, [examId, applySession, navigate]);

  const handleBack = useCallback(() => {
    void navigate({
      to: "/exam/$examId/instructions",
      params: { examId },
      search: { revisit: true },
    });
  }, [navigate, examId]);

  // Steps can't be skipped: the server's attempt status decides where the candidate belongs.
  // A READY candidate may deliberately come back to view the (read-only) completed step.
  const step = stepForStatus(session.attemptStatus);
  if (step !== "identity" && !(step === "start" && revisit)) {
    return <Navigate to={routeForStatus(session.attemptStatus)} params={{ examId }} replace />;
  }

  return (
    <IdentityVerification
      session={session}
      expired={expired}
      onProceed={handleProceed}
      onBack={handleBack}
    />
  );
}

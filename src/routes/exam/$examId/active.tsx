import { useCallback } from "react";
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { ActiveExam } from "@/components/exam/active/ActiveExam";
import { useExamFlow } from "@/components/exam/exam-flow-context";
import { releaseAllMedia } from "@/lib/exam/media-registry";
import { routeForStatus, stepForStatus } from "@/lib/exam/steps";

interface ActiveSearch {
  /** 1-based question number. Only a position in the server's paper, never a question id. */
  q?: number;
}

/** The running exam. Reachable only while the server reports the attempt IN_PROGRESS. */
export const Route = createFileRoute("/exam/$examId/active")({
  validateSearch: (search: Record<string, unknown>): ActiveSearch => {
    const q = Number(search.q);
    return Number.isInteger(q) && q >= 1 && q <= 10_000 ? { q } : {};
  },
  staticData: { examStep: "start" },
  head: () => ({ meta: [{ title: "Examination · KProctor" }] }),
  // The camera and microphone never keep running after leaving the exam.
  onLeave: () => releaseAllMedia(),
  component: ActiveExamPage,
});

function ActiveExamPage() {
  const { examId } = Route.useParams();
  const { q } = Route.useSearch();
  const navigate = useNavigate();
  const { session, expired, refreshSession } = useExamFlow();

  const onQuestionChange = useCallback(
    (number: number) => {
      void navigate({
        to: "/exam/$examId/active",
        params: { examId },
        search: { q: number },
        replace: true,
      });
    },
    [navigate, examId],
  );

  if (stepForStatus(session.attemptStatus) !== "active") {
    return <Navigate to={routeForStatus(session.attemptStatus)} params={{ examId }} replace />;
  }

  return (
    <ActiveExam
      session={session}
      expired={expired}
      questionNumber={q}
      onQuestionChange={onQuestionChange}
      refreshSession={refreshSession}
    />
  );
}

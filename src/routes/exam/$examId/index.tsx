import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useExamFlow } from "@/components/exam/exam-flow-context";
import { routeForStatus } from "@/lib/exam/steps";

/** /exam/:examId → the step the server says the candidate is on. */
export const Route = createFileRoute("/exam/$examId/")({
  component: ExamEntry,
});

function ExamEntry() {
  const { examId } = Route.useParams();
  const { session } = useExamFlow();
  return <Navigate to={routeForStatus(session.attemptStatus)} params={{ examId }} replace />;
}

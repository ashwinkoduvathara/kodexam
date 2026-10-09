import { createFileRoute } from "@tanstack/react-router";
import { startExamAttempt } from "@/server/api/exam-api";
import { clientIp } from "@/server/request-ip";

export const Route = createFileRoute("/api/exams/$examId/attempts")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        startExamAttempt(request, params.examId, { ipAddress: clientIp() }),
    },
  },
});

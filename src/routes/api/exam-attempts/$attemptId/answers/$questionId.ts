import { createFileRoute } from "@tanstack/react-router";
import { saveExamAnswer } from "@/server/api/exam-paper-api";
import { clientIp } from "@/server/request-ip";

export const Route = createFileRoute("/api/exam-attempts/$attemptId/answers/$questionId")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        saveExamAnswer(request, params.attemptId, params.questionId, { ipAddress: clientIp() }),
    },
  },
});

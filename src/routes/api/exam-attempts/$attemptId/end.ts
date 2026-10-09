import { createFileRoute } from "@tanstack/react-router";
import { endExamAttempt } from "@/server/api/exam-api";
import { clientIp } from "@/server/request-ip";

export const Route = createFileRoute("/api/exam-attempts/$attemptId/end")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        endExamAttempt(request, params.attemptId, { ipAddress: clientIp() }),
    },
  },
});

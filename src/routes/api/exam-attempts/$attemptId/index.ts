import { createFileRoute } from "@tanstack/react-router";
import { getExamAttempt } from "@/server/api/exam-api";
import { clientIp } from "@/server/request-ip";

export const Route = createFileRoute("/api/exam-attempts/$attemptId/")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        getExamAttempt(request, params.attemptId, { ipAddress: clientIp() }),
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { startExam } from "@/server/api/exam-api";
import { clientIp } from "@/server/request-ip";

export const Route = createFileRoute("/api/exam-attempts/$attemptId/start-exam")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        startExam(request, params.attemptId, { ipAddress: clientIp() }),
    },
  },
});

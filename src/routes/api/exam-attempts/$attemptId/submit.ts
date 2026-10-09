import { createFileRoute } from "@tanstack/react-router";
import { submitExam } from "@/server/api/exam-api";
import { clientIp } from "@/server/request-ip";

export const Route = createFileRoute("/api/exam-attempts/$attemptId/submit")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        submitExam(request, params.attemptId, { ipAddress: clientIp() }),
    },
  },
});

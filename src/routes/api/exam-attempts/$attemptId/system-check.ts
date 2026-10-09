import { createFileRoute } from "@tanstack/react-router";
import { submitSystemCheck } from "@/server/api/exam-api";
import { clientIp } from "@/server/request-ip";

export const Route = createFileRoute("/api/exam-attempts/$attemptId/system-check")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        submitSystemCheck(request, params.attemptId, { ipAddress: clientIp() }),
    },
  },
});

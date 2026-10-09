import { createFileRoute } from "@tanstack/react-router";
import { acknowledgeInstructions } from "@/server/api/exam-api";
import { clientIp } from "@/server/request-ip";

export const Route = createFileRoute("/api/exam-attempts/$attemptId/instructions/acknowledge")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        acknowledgeInstructions(request, params.attemptId, { ipAddress: clientIp() }),
    },
  },
});

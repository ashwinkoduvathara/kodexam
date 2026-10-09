import { createFileRoute } from "@tanstack/react-router";
import { startIdentityVerification } from "@/server/api/identity-api";
import { clientIp } from "@/server/request-ip";

export const Route = createFileRoute("/api/exam-attempts/$attemptId/identity/start")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        startIdentityVerification(request, params.attemptId, { ipAddress: clientIp() }),
    },
  },
});

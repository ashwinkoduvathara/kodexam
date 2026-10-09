import { createFileRoute } from "@tanstack/react-router";
import { retryIdentityVerification } from "@/server/api/identity-api";
import { clientIp } from "@/server/request-ip";

export const Route = createFileRoute("/api/exam-attempts/$attemptId/identity/retry")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        retryIdentityVerification(request, params.attemptId, { ipAddress: clientIp() }),
    },
  },
});

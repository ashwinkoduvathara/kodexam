import { createFileRoute } from "@tanstack/react-router";
import { verifyIdentity } from "@/server/api/identity-api";
import { clientIp } from "@/server/request-ip";

export const Route = createFileRoute("/api/exam-attempts/$attemptId/identity/verify")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        verifyIdentity(request, params.attemptId, { ipAddress: clientIp() }),
    },
  },
});

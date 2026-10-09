import { createFileRoute } from "@tanstack/react-router";
import { getIdentityStatus } from "@/server/api/identity-api";
import { clientIp } from "@/server/request-ip";

export const Route = createFileRoute("/api/exam-attempts/$attemptId/identity/status")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        getIdentityStatus(request, params.attemptId, { ipAddress: clientIp() }),
    },
  },
});

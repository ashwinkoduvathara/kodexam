import { createFileRoute } from "@tanstack/react-router";
import { captureIdentityPhoto } from "@/server/api/identity-api";
import { clientIp } from "@/server/request-ip";

export const Route = createFileRoute("/api/exam-attempts/$attemptId/identity/capture")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        captureIdentityPhoto(request, params.attemptId, { ipAddress: clientIp() }),
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { createIdentityAssetAccess } from "@/server/api/identity-api";
import { clientIp } from "@/server/request-ip";

export const Route = createFileRoute("/api/review/identity-verifications/$verificationId/access")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        createIdentityAssetAccess(request, params.verificationId, { ipAddress: clientIp() }),
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { decideIdentityReview } from "@/server/api/identity-api";
import { clientIp } from "@/server/request-ip";

export const Route = createFileRoute("/api/review/identity-verifications/$verificationId/decision")(
  {
    server: {
      handlers: {
        POST: ({ request, params }) =>
          decideIdentityReview(request, params.verificationId, { ipAddress: clientIp() }),
      },
    },
  },
);

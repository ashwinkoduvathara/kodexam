import { createFileRoute } from "@tanstack/react-router";
import { getIdentityReview } from "@/server/api/identity-api";

export const Route = createFileRoute("/api/review/identity-verifications/$verificationId/")({
  server: {
    handlers: {
      GET: ({ request, params }) => getIdentityReview(request, params.verificationId),
    },
  },
});

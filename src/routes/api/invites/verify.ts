import { createFileRoute } from "@tanstack/react-router";
import { verifyInvite } from "@/server/invites/invite-api";
import { clientIp } from "@/server/request-ip";

export const Route = createFileRoute("/api/invites/verify")({
  server: {
    handlers: {
      POST: ({ request }) => verifyInvite(request, { ipAddress: clientIp() }),
    },
  },
});

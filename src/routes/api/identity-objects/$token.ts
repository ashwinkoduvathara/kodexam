import { createFileRoute } from "@tanstack/react-router";
import { serveIdentityObject } from "@/server/api/identity-api";

/** Short-lived signed access to one encrypted identity object (local storage provider). */
export const Route = createFileRoute("/api/identity-objects/$token")({
  server: {
    handlers: {
      GET: ({ request, params }) => serveIdentityObject(request, params.token),
    },
  },
});

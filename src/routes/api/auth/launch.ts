import { createFileRoute } from "@tanstack/react-router";
import { handleLaunch } from "@/server/auth/launch";

export const Route = createFileRoute("/api/auth/launch")({
  server: {
    handlers: {
      GET: ({ request }) => handleLaunch(request),
    },
  },
});

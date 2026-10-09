import { createFileRoute } from "@tanstack/react-router";
import { NO_STORE } from "@/lib/exam/network-test.server";

export const Route = createFileRoute("/api/network-test/ping")({
  server: {
    handlers: {
      GET: () => new Response("ok", { headers: { ...NO_STORE, "content-type": "text/plain" } }),
    },
  },
});

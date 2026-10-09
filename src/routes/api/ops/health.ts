import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/server/db/mongodb";
import { getExpiryWorkerConfig } from "@/server/jobs/config";
import { getJobHealth, opsAuthorized } from "@/server/ops/health";

/**
 * GET /api/ops/health — for uptime monitors and alerting: 200 when healthy,
 * 503 when degraded. 404 unless KPROCTOR_OPS_TOKEN is configured.
 */
export const Route = createFileRoute("/api/ops/health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const headers = { "cache-control": "no-store" };
        const auth = opsAuthorized(request);
        if (auth === "disabled") return new Response(null, { status: 404, headers });
        if (!auth) return Response.json({ error: "unauthorized" }, { status: 401, headers });
        const health = await getJobHealth(await getDb(), getExpiryWorkerConfig());
        return Response.json(health, { status: health.status === "ok" ? 200 : 503, headers });
      },
    },
  },
});

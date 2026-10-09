import { createFileRoute } from "@tanstack/react-router";
import { isSecureRequest } from "@/server/auth/launch";
import { processLmsLaunch } from "@/server/auth/lms-launch";
import { getDb } from "@/server/db/mongodb";
import { auditContext } from "@/server/http/api";
import { clientIp } from "@/server/request-ip";

/**
 * LMS launch: GET ?token=… or POST (application/x-www-form-urlencoded, field
 * `token`; preferred, as it keeps the token out of URLs and access logs).
 * Success → session cookie + 302 into the exam. Any failure → the same generic
 * 302, so a probe learns nothing about why.
 */
async function launch(request: Request, token: string | null) {
  const result = await processLmsLaunch(await getDb(), token, {
    ctx: auditContext(request, clientIp()),
    secure: isSecureRequest(request),
  });
  const headers: Record<string, string> = {
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
  };
  if (!result.ok) {
    return new Response(null, {
      status: 302,
      headers: { ...headers, location: "/?launch=invalid" },
    });
  }
  return new Response(null, {
    status: 302,
    headers: { ...headers, location: result.location, "set-cookie": result.cookie },
  });
}

export const Route = createFileRoute("/api/auth/lms-launch")({
  server: {
    handlers: {
      GET: ({ request }) => launch(request, new URL(request.url).searchParams.get("token")),
      POST: async ({ request }) => {
        const type = request.headers.get("content-type") ?? "";
        if (!type.startsWith("application/x-www-form-urlencoded")) return launch(request, null);
        const text = await request.text();
        if (text.length > 8192) return launch(request, null);
        return launch(request, new URLSearchParams(text).get("token"));
      },
    },
  },
});

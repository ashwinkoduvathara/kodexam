import "@tanstack/react-start/server-only";
import { sessionCookie, verifyCandidateToken } from "./candidate-auth";
import { getLaunchConfig } from "./launch-config";

/** Only same-site paths are allowed as a post-launch destination (no open redirects). */
export function safeNextPath(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  return next;
}

/** Whether the request reached us over HTTPS (directly or via a trusted proxy). */
export function isSecureRequest(request: Request): boolean {
  const url = new URL(request.url);
  return (
    url.protocol === "https:" ||
    (process.env.KPROCTOR_TRUST_PROXY === "true" &&
      request.headers.get("x-forwarded-proto") === "https")
  );
}

/**
 * DEVELOPMENT launch: GET /api/auth/launch?token=…&next=/exam/<examId>
 *
 * The token here is a long-lived KProctor session token (printed by the dev
 * seed), so this route is refused in production unless KPROCTOR_ALLOW_DEV_LAUNCH
 * is explicitly "true". Real candidates arrive through /api/auth/lms-launch.
 */
export function handleLaunch(request: Request): Response {
  const url = new URL(request.url);
  const config = getLaunchConfig();
  const token = url.searchParams.get("token");
  const payload = token && config.allowDevLaunch ? verifyCandidateToken(token) : null;
  const next = safeNextPath(url.searchParams.get("next"));

  if (!token || !payload) {
    return new Response(null, {
      status: 302,
      headers: { location: "/?launch=invalid", "cache-control": "no-store" },
    });
  }

  const maxAge = payload.exp - Math.floor(Date.now() / 1000);
  const cookie = sessionCookie(token, maxAge, isSecureRequest(request) || config.production);

  return new Response(null, {
    status: 302,
    headers: { location: next, "set-cookie": cookie, "cache-control": "no-store" },
  });
}

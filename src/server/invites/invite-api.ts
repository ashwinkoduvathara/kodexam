import "@tanstack/react-start/server-only";
import type { VerifyInviteResponse } from "@/types/invite";
import { sessionCookie } from "../auth/candidate-auth";
import { isSecureRequest } from "../auth/launch";
import { getLaunchConfig } from "../auth/launch-config";
import { getDb } from "../db/mongodb";
import { assertSameOrigin, auditContext, handleApi, json, readJson } from "../http/api";
import { createInviteService } from "./invite-service";

/**
 * POST /api/invites/verify — exchanges a matching invite for the standard
 * exam-scoped KProctor session cookie (HttpOnly, SameSite=Lax, Secure on
 * HTTPS / in production). The session token never appears in the body.
 */
export function verifyInvite(request: Request, opts: { ipAddress?: string | null } = {}) {
  return handleApi(async () => {
    assertSameOrigin(request);
    const body = await readJson<unknown>(request);
    const result = await createInviteService(await getDb()).redeem(
      body,
      auditContext(request, opts.ipAddress),
    );
    const secure = isSecureRequest(request) || getLaunchConfig().production;
    const payload: VerifyInviteResponse = { redirectTo: result.redirectTo };
    const response = json(payload);
    response.headers.set(
      "set-cookie",
      sessionCookie(result.sessionToken, result.sessionTtlSeconds, secure),
    );
    return response;
  });
}

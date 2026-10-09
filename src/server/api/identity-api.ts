import "@tanstack/react-start/server-only";
import { API_ERROR } from "@/types/api";
import type { IdentityVerifyResponse } from "@/types/identity";
import { authenticateCandidate } from "../auth/candidate-auth";
import { getDb } from "../db/mongodb";
import { DomainError } from "../errors";
import {
  assertSameOrigin,
  assertSecureTransport,
  auditContext,
  handleApi,
  json,
  readBinaryBody,
  readJson,
} from "../http/api";
import { getIdentityConfig } from "../identity/config";
import { getLocalObjectServer } from "../identity/storage";
import { createIdentityVerificationService } from "../services/identity-verification-service";

/**
 * Identity verification REST handlers. Every handler: HTTPS (production),
 * same-origin for mutations, authenticated candidate/reviewer, ownership and
 * state checks in the service, rate limits, audit events, minimal responses.
 */

interface HandlerOptions {
  ipAddress?: string | null;
}

async function service() {
  return createIdentityVerificationService(await getDb());
}

function guard(request: Request, mutation: boolean) {
  assertSecureTransport(request);
  if (mutation) assertSameOrigin(request);
}

export function getIdentityStatus(request: Request, attemptId: string, opts: HandlerOptions = {}) {
  return handleApi(async () => {
    guard(request, false);
    const candidateId = authenticateCandidate(request);
    return json(
      await (
        await service()
      ).getStatus(attemptId, candidateId, auditContext(request, opts.ipAddress)),
    );
  });
}

export function startIdentityVerification(
  request: Request,
  attemptId: string,
  opts: HandlerOptions = {},
) {
  return handleApi(async () => {
    guard(request, true);
    const candidateId = authenticateCandidate(request);
    return json(
      await (await service()).start(attemptId, candidateId, auditContext(request, opts.ipAddress)),
    );
  });
}

/** Body: the raw JPEG (Content-Type: image/jpeg). Never multipart, never in a URL. */
export function captureIdentityPhoto(
  request: Request,
  attemptId: string,
  opts: HandlerOptions = {},
) {
  return handleApi(async () => {
    guard(request, true);
    const candidateId = authenticateCandidate(request);
    const bytes = await readBinaryBody(request, getIdentityConfig().maxPhotoBytes);
    return json(
      await (
        await service()
      ).capturePhoto(attemptId, candidateId, bytes, auditContext(request, opts.ipAddress)),
    );
  });
}

/**
 * Body: the raw file. Headers: Content-Type (declared MIME),
 * X-Document-Type (ID type), X-File-Extension. All are re-validated server-side.
 */
export function uploadIdentityDocument(
  request: Request,
  attemptId: string,
  opts: HandlerOptions = {},
) {
  return handleApi(async () => {
    guard(request, true);
    const candidateId = authenticateCandidate(request);
    const bytes = await readBinaryBody(request, getIdentityConfig().maxDocumentBytes);
    return json(
      await (
        await service()
      ).uploadDocument(
        attemptId,
        candidateId,
        {
          bytes,
          declaredMime: request.headers.get("content-type"),
          declaredExtension: request.headers.get("x-file-extension"),
          documentType: request.headers.get("x-document-type"),
        },
        auditContext(request, opts.ipAddress),
      ),
    );
  });
}

export function deleteIdentityDocument(
  request: Request,
  attemptId: string,
  opts: HandlerOptions = {},
) {
  return handleApi(async () => {
    guard(request, true);
    const candidateId = authenticateCandidate(request);
    return json(
      await (
        await service()
      ).deleteDocument(attemptId, candidateId, auditContext(request, opts.ipAddress)),
    );
  });
}

/** Body: `{ consent: true }`. Any other field (e.g. `verified`, `faceMatch`) is ignored. */
export function verifyIdentity(request: Request, attemptId: string, opts: HandlerOptions = {}) {
  return handleApi(async () => {
    guard(request, true);
    const candidateId = authenticateCandidate(request);
    const body = await readJson<{ consent?: unknown }>(request);
    const result: IdentityVerifyResponse = await (
      await service()
    ).verify(
      attemptId,
      candidateId,
      { consent: body.consent },
      auditContext(request, opts.ipAddress),
    );
    return json(result);
  });
}

export function retryIdentityVerification(
  request: Request,
  attemptId: string,
  opts: HandlerOptions = {},
) {
  return handleApi(async () => {
    guard(request, true);
    const candidateId = authenticateCandidate(request);
    return json(
      await (await service()).retry(attemptId, candidateId, auditContext(request, opts.ipAddress)),
    );
  });
}

// ─── Reviewer (examiner / admin) ─────────────────────────────────────────────

export function getIdentityReview(request: Request, verificationId: string) {
  return handleApi(async () => {
    guard(request, false);
    const reviewerId = authenticateCandidate(request); // same token format; role checked in service
    return json(await (await service()).getForReview(verificationId, reviewerId));
  });
}

export function createIdentityAssetAccess(
  request: Request,
  verificationId: string,
  opts: HandlerOptions = {},
) {
  return handleApi(async () => {
    guard(request, true);
    const reviewerId = authenticateCandidate(request);
    const body = await readJson<{ asset?: unknown }>(request);
    return json(
      await (
        await service()
      ).createAssetAccess(
        verificationId,
        reviewerId,
        body.asset,
        auditContext(request, opts.ipAddress),
      ),
    );
  });
}

export function decideIdentityReview(
  request: Request,
  verificationId: string,
  opts: HandlerOptions = {},
) {
  return handleApi(async () => {
    guard(request, true);
    const reviewerId = authenticateCandidate(request);
    const body = await readJson<{ decision?: unknown; expectedVersion?: unknown }>(request);
    return json(
      await (
        await service()
      ).decide(verificationId, reviewerId, body, auditContext(request, opts.ipAddress)),
    );
  });
}

// ─── Signed object access (local provider only) ─────────────────────────────

/** Serves one decrypted object for a valid, unexpired signed token. */
export async function serveIdentityObject(request: Request, token: string): Promise<Response> {
  try {
    assertSecureTransport(request);
  } catch (error) {
    if (error instanceof DomainError) return new Response(null, { status: 403 });
  }
  const server = getLocalObjectServer();
  const object = server ? await server.serve(token) : null;
  if (!object) {
    return Response.json(
      { error: { code: API_ERROR.NOT_FOUND, message: "This link has expired." } },
      { status: 410, headers: { "cache-control": "no-store" } },
    );
  }
  return new Response(new Uint8Array(object.body), {
    status: 200,
    headers: {
      "content-type": object.contentType,
      "cache-control": "no-store, private",
      "content-disposition": "inline",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; sandbox",
      "referrer-policy": "no-referrer",
    },
  });
}

import "@tanstack/react-start/server-only";
import { API_ERROR, type ApiErrorBody, type ApiErrorCode } from "@/types/api";
import { DatabaseUnavailableError } from "../db/mongodb";
import { TransactionsUnavailableError } from "../db/transactions";
import { logError } from "../log";
import { ServerConfigError } from "../env";
import { DomainError } from "../errors";
import type { AuditContext } from "../repositories/audit-log-repository";

const NO_STORE = { "cache-control": "no-store" };

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: NO_STORE });
}

export function apiError(
  code: ApiErrorCode,
  status: number,
  message: string,
  details?: Record<string, unknown>,
): Response {
  const body: ApiErrorBody = { error: { code, message, ...(details ? { details } : {}) } };
  return json(body, status);
}

/** Maps thrown errors to safe JSON responses. Internal details are logged, never returned. */
export async function handleApi(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof DomainError) {
      return apiError(error.code, error.status, error.message, error.details);
    }
    if (
      error instanceof DatabaseUnavailableError ||
      error instanceof TransactionsUnavailableError
    ) {
      logError("database unavailable", error);
      return apiError(
        API_ERROR.SERVICE_UNAVAILABLE,
        503,
        "The exam service is temporarily unavailable. Please try again shortly.",
      );
    }
    if (error instanceof ServerConfigError) {
      // Names only the misconfigured setting — never its value.
      console.error(`[kproctor] ${error.message}`);
      return apiError(
        API_ERROR.SERVICE_UNAVAILABLE,
        503,
        "This service is temporarily unavailable. Please try again shortly or contact support.",
      );
    } else {
      // Name/code only: error messages can embed request data.
      logError("unhandled API error", error);
    }
    return apiError(API_ERROR.INTERNAL, 500, "Something went wrong. Please try again.");
  }
}

/**
 * CSRF defence for cookie-authenticated mutations: browsers always send
 * `Origin` on cross-site POSTs, so reject any that don't match this host.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    /* malformed origin */
  }
  if (!host || originHost !== host) {
    throw new DomainError(API_ERROR.FORBIDDEN, 403, "This request was blocked.");
  }
}

const MAX_JSON_BYTES = 16 * 1024;

export async function readJson<T>(request: Request): Promise<T> {
  const text = await request.text();
  if (text.length > MAX_JSON_BYTES) {
    throw new DomainError(API_ERROR.VALIDATION_ERROR, 413, "Request is too large.");
  }
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new DomainError(API_ERROR.VALIDATION_ERROR, 400, "Request body must be valid JSON.");
  }
}

/**
 * Only what the audit trail needs: client IP and a truncated user agent.
 * The IP comes from the server runtime (see request-ip.ts), never a raw header.
 */
export function auditContext(request: Request, ipAddress?: string | null): AuditContext {
  return {
    ipAddress: ipAddress ?? null,
    userAgent: request.headers.get("user-agent")?.slice(0, 256) ?? null,
  };
}

/**
 * Reads a binary request body with a hard size cap. Rejects early on a too-large
 * Content-Length and stops reading as soon as the cap is exceeded, so oversized
 * uploads are never buffered in full.
 */
export async function readBinaryBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  const tooLarge = () =>
    new DomainError(
      API_ERROR.PAYLOAD_TOO_LARGE,
      413,
      `This file is larger than ${Math.round((maxBytes / 1024 / 1024) * 10) / 10} MB.`,
    );
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?$/i;

/**
 * Identity data only travels over HTTPS in production. Loopback hosts are
 * treated as secure (browsers do the same) so local testing still works.
 */
export function assertSecureTransport(request: Request): void {
  if (process.env.NODE_ENV !== "production") return;
  const proto =
    process.env.KPROCTOR_TRUST_PROXY === "true"
      ? (request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", ""))
      : new URL(request.url).protocol.replace(":", "");
  const host = request.headers.get("host") ?? "";
  if (proto !== "https" && !LOOPBACK.test(host)) {
    throw new DomainError(API_ERROR.INSECURE_TRANSPORT, 403, "Secure connection required.");
  }
}

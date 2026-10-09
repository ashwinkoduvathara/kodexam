import "@tanstack/react-start/server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { ObjectId } from "mongodb";
import { getServerConfig } from "../env";
import { unauthenticated } from "../errors";

/**
 * Candidate authentication for KProctor.
 *
 * The LMS (or the dev seed script) issues a short-lived signed launch token
 * (HMAC-SHA256, compact JWT-like format). `/api/auth/launch` verifies it and
 * stores it in an HttpOnly cookie. Every API request derives the candidate
 * from that cookie — client-supplied candidate IDs are never trusted.
 *
 * To integrate with the LMS's Firebase auth instead, replace
 * `verifyCandidateToken` with Firebase Admin ID-token verification.
 */

export const SESSION_COOKIE = "kp_session";
const AUDIENCE = "kproctor";
const DEFAULT_TTL_SECONDS = 8 * 60 * 60;

export interface CandidateTokenPayload {
  sub: string;
  aud: typeof AUDIENCE;
  iat: number;
  exp: number;
  /** Exam this session is scoped to (sessions from an LMS launch). Absent = unscoped (dev). */
  exm?: string;
}

const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");
const sign = (data: string, secret: string) => createHmac("sha256", secret).update(data).digest();

export function signCandidateToken(
  candidateId: string,
  options: { secret?: string; ttlSeconds?: number; now?: number; examId?: string } = {},
): string {
  const secret = options.secret ?? getServerConfig().authSecret;
  const iat = Math.floor((options.now ?? Date.now()) / 1000);
  const payload: CandidateTokenPayload = {
    sub: candidateId,
    aud: AUDIENCE,
    iat,
    exp: iat + (options.ttlSeconds ?? DEFAULT_TTL_SECONDS),
    ...(options.examId ? { exm: options.examId } : {}),
  };
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  return `${header}.${body}.${b64url(sign(`${header}.${body}`, secret))}`;
}

export function verifyCandidateToken(
  token: string,
  options: { secret?: string; now?: number } = {},
): CandidateTokenPayload | null {
  const secret = options.secret ?? getServerConfig().authSecret;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;

  const expected = sign(`${header}.${body}`, secret);
  const provided = Buffer.from(signature, "base64url");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as CandidateTokenPayload;
    const now = Math.floor((options.now ?? Date.now()) / 1000);
    if (payload.aud !== AUDIENCE || typeof payload.exp !== "number" || payload.exp <= now)
      return null;
    if (typeof payload.sub !== "string" || !/^[a-f\d]{24}$/i.test(payload.sub)) return null;
    if (payload.exm !== undefined && !/^[a-f\d]{24}$/i.test(String(payload.exm))) return null;
    return payload;
  } catch {
    return null;
  }
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/** The authenticated candidate and, for LMS launches, the exam the session is scoped to. */
export function authenticateSession(request: Request): {
  candidateId: ObjectId;
  examScope: ObjectId | null;
} {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const token = bearer ?? readCookie(request, SESSION_COOKIE);
  const payload = token ? verifyCandidateToken(token) : null;
  if (!payload) throw unauthenticated();
  return {
    candidateId: new ObjectId(payload.sub),
    examScope: payload.exm ? new ObjectId(payload.exm) : null,
  };
}

/** Returns the authenticated candidate's id, or throws UNAUTHENTICATED. */
export function authenticateCandidate(request: Request): ObjectId {
  return authenticateSession(request).candidateId;
}

/** The KProctor session cookie: HttpOnly, SameSite=Lax, Secure whenever served over HTTPS / in production. */
export function sessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

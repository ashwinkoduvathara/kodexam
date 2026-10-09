/**
 * Reference signer for the Kodeversity LMS backend. Dependency-free (node:crypto).
 * Copy into the LMS server code; it must only ever run server-side.
 *
 * Flow:
 * 1. The LMS authenticates the user with its OWN sign-in (Firebase Admin ID-token
 *    verification, or the LMS session) on the server. Never trust a client claim.
 * 2. The LMS checks the user is enrolled in / allowed to take the exam.
 * 3. It calls createKProctorLaunch() and sends the browser to KProctor, preferably
 *    with an auto-submitted POST form (renderLaunchForm) so the token stays out of URLs.
 *
 * Keys: generate once with `npm run lms:keygen` in KProctor (or any Ed25519 tool).
 * The PRIVATE key stays in the LMS secret store (env/secret manager), never in Git
 * or the browser. KProctor gets only the PUBLIC key (KPROCTOR_LMS_LAUNCH_PUBLIC_KEY).
 */
import { createPrivateKey, randomBytes, sign, type KeyObject } from "node:crypto";

export interface KProctorLaunchInput {
  /** PEM (PKCS#8) Ed25519 private key, or a KeyObject. */
  privateKey: string | KeyObject;
  /** Must equal KPROCTOR_LMS_ISSUER on the KProctor side. */
  issuer: string;
  /** KProctor base URL, e.g. https://exam.kodeversity.com */
  kproctorUrl: string;
  /** Stable LMS user id (e.g. the LMS users._id or Firebase uid). */
  lmsUserId: string;
  /** KProctor exam code or id. */
  exam: string;
  /** Profile used when KProctor creates the candidate on first launch. */
  name: string;
  email?: string;
  rollNumber?: string;
  /** Seconds; KProctor accepts at most KPROCTOR_LAUNCH_MAX_LIFETIME_SECONDS (default 120). */
  ttlSeconds?: number;
}

const b64url = (v: Buffer | string) => Buffer.from(v).toString("base64url");

export function createKProctorLaunch(input: KProctorLaunchInput) {
  const key =
    typeof input.privateKey === "string" ? createPrivateKey(input.privateKey) : input.privateKey;
  const iat = Math.floor(Date.now() / 1000);
  const payload = {
    iss: input.issuer,
    aud: "kproctor-launch",
    sub: input.lmsUserId,
    jti: randomBytes(24).toString("base64url"),
    iat,
    exp: iat + Math.min(input.ttlSeconds ?? 60, 120),
    exam: input.exam,
    name: input.name,
    ...(input.email ? { email: input.email } : {}),
    ...(input.rollNumber ? { rollNumber: input.rollNumber } : {}),
  };
  const head = b64url(JSON.stringify({ alg: "EdDSA", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const token = `${head}.${body}.${b64url(sign(null, Buffer.from(`${head}.${body}`), key))}`;
  return {
    token,
    action: `${input.kproctorUrl.replace(/\/$/, "")}/api/auth/lms-launch`,
  };
}

/** Minimal auto-submitting form (serve with a strict CSP and Cache-Control: no-store). */
export function renderLaunchForm(launch: { token: string; action: string }) {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html><html><body onload="document.forms[0].submit()">
<form method="post" action="${esc(launch.action)}"><input type="hidden" name="token" value="${esc(launch.token)}">
<noscript><button type="submit">Continue to your exam</button></noscript></form></body></html>`;
}

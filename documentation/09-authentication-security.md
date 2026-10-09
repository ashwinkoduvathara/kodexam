# 09 — Authentication & Security

## Candidate authentication — [`candidate-auth.ts`](../src/server/auth/candidate-auth.ts)

KProctor never trusts a candidate ID sent by the browser. Identity always comes from a signed token.

There are two ways in:
- **Production: LMS launch.** A short-lived, single-use Ed25519 token is exchanged for a session (see [below](#lms-launch-production)).
- **Development launch link.** Printed by the dev seed. It is refused in production unless `KPROCTOR_ALLOW_DEV_LAUNCH=true`.

**Session token** (also what the dev link carries): a compact HMAC-SHA256 (JWT-style) token signed with `KPROCTOR_AUTH_SECRET`:

```json
{ "sub": "<candidate ObjectId>", "aud": "kproctor", "iat": 1791000000, "exp": 1791028800 }
```

- Default lifetime is 8 hours.
- Verification checks the signature (constant-time compare), audience, expiry and the ObjectId format.
- Sessions from an LMS launch carry `"exm": "<examId>"`. Such a session can only open or start that exam (`403` for any other).

**Development launch flow** ([`launch.ts`](../src/server/auth/launch.ts)):

```
LMS (or the dev seed) → /api/auth/launch?token=…&next=/exam/<examId>
                          ↓ verify token
                          Set-Cookie: kp_session=<token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=…; Secure (on HTTPS)
                          ↓ 302 redirect to `next`
```

- `next` must be a same-site path. `//evil.com`, absolute URLs and backslash tricks are rejected and redirect to `/`.
- An invalid or expired token redirects to `/?launch=invalid`.
- The token is never readable by page JavaScript.

**Every API request:** `authenticateCandidate(request)` reads the cookie (or `Authorization: Bearer`), verifies it, and returns the candidate ID. The service then checks that the candidate exists and is `ACTIVE`.

## Ownership

Attempt lookups include `candidateId` in the database query. Another candidate's attempt is therefore simply "not found" (`404`), which also avoids revealing that it exists.

State changes use atomic conditional updates. They only apply if the attempt is owned by the candidate, in an allowed status, and not expired.

## CSRF protection

- The cookie is `SameSite=Lax`, so it isn't sent on cross-site POSTs.
- POST handlers also compare the `Origin` header with the host and reject mismatches (`403 FORBIDDEN`).

## Secrets

- `MONGODB_URI` and `KPROCTOR_AUTH_SECRET` are read only through `process.env` in server-only modules.
- Server modules import `@tanstack/react-start/server-only`, so the build fails if client code imports them.
- A scan of the production client bundle found no driver, connection string, secret value, HMAC code or collection names.
- Database errors never include the connection string.
- `.env` and `.env.*` are git-ignored.

## Audit logging

Security-relevant actions write to `auditLogs` with `eventType`, a server `timestamp`, `actorType` and `actorId` (see [07 — Database](07-database.md)). Identity events are listed in [14 — Identity Data Security](14-identity-data-security.md#8-audit-trail).
The IP comes from the server runtime (`getRequestIP`); `X-Forwarded-For` is trusted only when `KPROCTOR_TRUST_PROXY=true`.

## Privacy

- Screen 1 never records or uploads camera or microphone data. The preview and audio analysis stay on the device.
- The system check sends only pass/fail results to the server.
- All media tracks are stopped when leaving the page.

## Security headers

Every response carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` (camera and microphone for this origin only), `X-Frame-Options: DENY` and `Cross-Origin-Opener-Policy: same-origin`. Production builds also send a **nonce-based Content-Security-Policy**, plus HSTS over HTTPS. Details: [14 — Identity Data Security](14-identity-data-security.md#12-security-headers).

## LMS launch (production)

[`lms-launch.ts`](../src/server/auth/lms-launch.ts), route `/api/auth/lms-launch`. It accepts GET `?token=`, or preferably a POST form so the token stays out of URLs and logs.

1. **LMS:** the LMS authenticates the user itself, server-side, and checks enrolment. It then signs a token with its **Ed25519 private key**, using [`integrations/lms/kproctor-launch.ts`](../integrations/lms/kproctor-launch.ts):
   ```json
   { "iss": "<KPROCTOR_LMS_ISSUER>", "aud": "kproctor-launch", "sub": "<LMS user id>",
     "jti": "<random, 16–128 chars>", "iat": 1791000000, "exp": 1791000060,
     "exam": "CN-2041", "name": "…", "email": "…", "rollNumber": "…" }
   ```
2. **KProctor verifies:**
   - the algorithm is pinned to `EdDSA` (no `none`, no HMAC confusion), and the signature checks against `KPROCTOR_LMS_LAUNCH_PUBLIC_KEY`
   - `iss`, `aud`, `exp`, and `iat` (not in the future beyond the clock skew)
   - lifetime ≤ `KPROCTOR_LAUNCH_MAX_LIFETIME_SECONDS` (default 120 s)
   - `jti` format
3. **One-time use:** the `jti` is inserted into `launchTokens` (unique `_id`, TTL-expired). A replay hits the duplicate key, which is atomic even under concurrent use.
4. **Authorization:**
   - The exam must exist, be published and its window not closed.
   - The LMS user maps to a candidate through `users.lmsUserId`, created on first launch from the signed profile.
   - Disabled or non-candidate accounts are refused.
   - An existing KProctor account with the same email or roll number is **not auto-linked** (`IDENTITY_CONFLICT`, an admin links it), to prevent account takeover.
5. **Session:** a KProctor session cookie is set, scoped to the exam: `HttpOnly; SameSite=Lax; Path=/; Secure` (always in production), lasting `KPROCTOR_SESSION_TTL_MINUTES`. The browser is redirected into the exam.

**Audit and logging:**
- Every success is audited as `CANDIDATE_LAUNCHED`.
- Every failure gets the same generic redirect (`/?launch=invalid`), plus an audit `LAUNCH_REJECTED { reason }` and a log line with the reason code only, never the token.
- Launches are rate-limited per IP.

Only the LMS's **public** key is held by KProctor, so a KProctor compromise can't be used to forge launches. Key generation and rotation are covered in [17 — Operations](17-operations.md#7-lms-launch-setup).

## Roles

The same signed token identifies candidates, examiners (`proctor`) and admins. Roles are read from the `users` collection on every request, never from the token alone. Identity-review endpoints reject candidates (`403`), and examiners only see exams they're assigned to.

## Integrating with the LMS

**Finding (2026-10-09):** the Kodeversity LMS repository has **no Firebase and no sign-in or session implementation**. Its `User` model has a `password` field, but nothing authenticates users yet.

So KProctor's side of the launch is implemented and tested, while the LMS side can't be wired up until the LMS authenticates users. Once it does, with Firebase Admin ID-token verification or its own sessions, it calls the reference signer server-side. Reusable Firebase tokens must never be put in URLs or sent to KProctor.

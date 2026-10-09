# 11 — Testing

## Summary (last run)

| Suite | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | ✅ No errors |
| Lint | `npm run lint` | ✅ 0 errors (1 warning, in the LMS-copied `button.tsx`) |
| Unit + integration | `npm test` | ✅ 116 / 116 (10 files) |
| Browser — dev server | `npm run test:e2e` | ✅ 36 / 36 (Screens 1, 2, 3) |
| Browser — production build | `E2E_BASE_URL=http://localhost:3200 E2E_EXPECT_CSP=true npm run test:e2e` | ✅ 24 / 24 scenarios run with the enforced nonce CSP (S3 identity flows excluded; see below) |
| Production build | `npm run build` | ✅ |

**Why the S3 identity flows aren't run against the production build:** production configuration *refuses* identity operations with development storage and no malware scanner. That refusal was verified: the production build answers identity requests with `503` and logs only the setting name.

## Unit & integration tests (Vitest)

**Configuration:** [`vitest.config.ts`](../vitest.config.ts).

- [`global-setup.ts`](../src/server/test/global-setup.ts) starts an **ephemeral single-node MongoDB replica set** (from the installed `mongod`, temp directory, random port), so transactions are tested for real.
- [`setup.ts`](../src/server/test/setup.ts) points the server at database `kodeproctor_test` and at encrypted local storage in a temp directory with a test-only key.
- Files run one at a time.

| File | Covers |
|---|---|
| `src/server/api/identity-api.test.ts` | **Screen 3 security (36 tests):** unauthenticated → 401; another candidate's attempt → 404; previous steps required; candidates can't use reviewer endpoints; examiner limited to assigned exams; full state walk; upload before photo refused; client `verified=true` / `faceMatch=true` ignored; consent required; expired → EXPIRED + audit; cancelled refused; 4 concurrent verifies → exactly one; **status + audit atomic (audit failure rolls back)**; executable / HTML / SVG / spoofed MIME / wrong extension rejected; PDF active content rejected; oversized → 413; unknown ID type; SHA-256 stored; encrypted object; duplicate upload idempotent; scan failure → nothing stored; infected → nothing stored; clean scan; delete removes object; upload rate limit → 429; no references/hashes/URLs in candidate responses; **ID number never in logs, DB or stored files**; signed URL works, tampered/expired rejected, view audited; reviewer approval advances attempt; **optimistic concurrency between two reviewers**; `ALLOW_PENDING_REVIEW` policy; reject → retry deletes evidence; retention purge + audit; audit record shape |
| `src/server/identity/identity-primitives.test.ts` | Envelope encryption round-trip, AAD binding, tamper/wrong-key detection; access-token expiry/forgery; SHA-256; magic-byte sniffing; image dimensions; extension/MIME/signature agreement; state-machine actor rules; ClamAV client (clean / infected / error / unreachable) against a fake clamd; security headers and CSP |
| `src/server/api/exam-api.test.ts` | Screens 1–2 endpoints: auth, session data, server deadline, idempotent start, attempt limit, exam window, CSRF, system-check validation, acknowledgement + audit, expiry, wrong candidate, concurrency, end attempt, **start-exam** (timer starts only then, full duration after a long setup, capped by the window, idempotent, wrong state / candidate / closed window, browser timing ignored, identity re-checked at READY, pending review only under `ALLOW_PENDING_REVIEW`, archived exam, refresh keeps the deadline) |
| `src/server/api/exam-paper-api.test.ts` | Paper before start, ordering/sections, no correct answers, ownership, foreign question/option, conflicts, idempotent retry, 5 concurrent writes, clear, review/visit, timeout auto-submit/expire, idempotent concurrent submit, submit racing answer writes, proctoring events (whitelist, server label/time, audit, list, ownership) |
| `src/lib/exam/paper/question-state.test.ts` | Navigator states and option letters |
| `src/server/jobs/expiry-worker.test.ts` | Expiry with no browser activity; auto-submit vs expire policy; stale setups; 4 workers racing over 30 attempts (each closed + audited exactly once); duplicate runs; failed close keeps its lease and is retried once after it expires; answer writes racing the deadline; lifecycle audit consistency; health ok/degraded (never run, failures, overdue, stale) |
| `src/server/auth/lms-launch.test.ts` | Valid launch → secure exam-scoped cookie + candidate created once; scoped session can't start another exam; single use + concurrent reuse; bad signature, tampering, `alg: none`, HS256 confusion, malformed; issuer, audience, expiry, future `iat`, lifetime, `jti`; unknown/draft/closed exam; disabled and staff accounts; no auto-linking by email; rejection audit has no token; dev link allowed in dev, refused in production unless enabled (then Secure) |
| `src/server/services/event-policy.test.ts` | Pure policy escalation; browser events never terminate (review + recommendation); trusted source terminates only when allowed; server warns neutrally, flags review once, audits; attempt keeps running |
| `src/server/identity/infra-outage.test.ts` | Real adapters against refused/hanging connections: ClamAV refused and hang → 503, nothing stored, `SCAN_FAILED` audit; S3 unreachable → photo/document 503, nothing recorded, no hostnames in messages; production refuses local storage / no scanner / no KMS; unscanned documents can't be verified in production |
| `src/server/db/indexes.test.ts` | Every required index (unique / TTL) exists; duplicate attempt rejected by the unique index; a failed transaction rolls back all writes |
| `src/lib/exam/start-eligibility.test.ts` | Screen 4 display rules: invalid states, expiry, missing steps, `BLOCK` vs `ALLOW_PENDING_REVIEW`, failed identity, `NOT_REQUIRED` |
| `src/server/auth/candidate-auth.test.ts` | Token round-trip, tampering, wrong secret, expiry, cookie-only identity, open-redirect protection |
| `src/lib/exam/session/http-exam-session-service.test.ts` | DTO mapping, `openSession` fallback, typed errors, safe network errors |
| `src/lib/exam/policy.test.ts` | Policy labels, flagged activities, status routing (incl. READY → Start Exam) |
| `src/lib/exam/readiness.test.ts`, `media.test.ts`, `network-test.test.ts`, `time.test.ts` | Screen 1 logic |

## Browser tests (`e2e/`)

[`e2e/run.ts`](../e2e/run.ts) drives real Chrome (`puppeteer-core`) with fake camera/mic devices, against the running app and its MongoDB.

- Fixtures are created per scenario with an `E2E-` prefix and deleted afterwards.
- **Requirements:** the app running (`E2E_BASE_URL`, default `http://localhost:3100`) against the same replica set, plus Chrome (`CHROME_PATH`).

```bash
npm run test:e2e                     # everything
E2E_ONLY=S3,T1 npm run test:e2e      # scenarios starting with these prefixes
```

### Screen 3 — [`identity.e2e.ts`](../e2e/identity.e2e.ts)

| Scenario | Proves |
|---|---|
| S3-1 | Full flow: capture → upload → consent → verify → **REVIEW_REQUIRED** → camera switched off → examiner gets a signed URL and approves via the API → page picks it up by polling → **Continue to Start Exam** → stepper shows 3 completed steps. Also: **no localStorage / sessionStorage / IndexedDB**, no identity data in the URL, all audit events present |
| S3-2 | HTML renamed `.jpg` is rejected by the server with a clear message |
| S3-3 | Refresh restores photo/document state from the server; Back opens the read-only instructions and returns |
| S3-4 | A forged `{verified: true, faceMatch: true}` request can't verify |
| S3-5 | Expired attempt shows the expired state, no controls |
| S3-6 | Security headers on pages and API; nonce CSP and nonce-tagged scripts on the production build |
| S3-7 | Production client bundle contains no auth secret, master key, MongoDB URI, driver or crypto code |

### Screen 2 — [`instructions.e2e.ts`](../e2e/instructions.e2e.ts) · Screen 1 — [`system-check.e2e.ts`](../e2e/system-check.e2e.ts)

All earlier scenarios (S2-1…S2-auth, T1…T15, X1, X2) still pass. S2 now lands on the real Screen 3 instead of the old placeholder.

Timer (the exam timer starts only when the exam starts):

| # | Scenario |
|---|---|
| S2-4 | During setup, if the exam window closes sooner than the duration, the header follows the server deadline (amber at 9:30) |
| S2-15 | During setup the header shows the full duration, frozen (`01:15:00` before and after a refresh) |
| S2-17 | After 40 minutes of setup, `start-exam` still gives the full 75 minutes, and the header switches to a running countdown |

### Screen 4 — [`start.e2e.ts`](../e2e/start.e2e.ts)

Each scenario builds a real READY attempt through the API: photo, document, consent, then an examiner's approval.

| # | Scenario |
|---|---|
| S4-1..3 | Overview values, monitoring tiles, stepper (1–3 complete, 4 current), status card and header duration all come from the server |
| S4-4..6 | Acknowledgement starts unchecked, gates Start, toggles with the keyboard |
| S4-10..13,15 | Slow server: navigation waits for confirmation; double click → 1 request; server start time and deadline; 1 `EXAM_STARTED` |
| S4-16 | Refresh on the running exam keeps the deadline; every preparation URL redirects to `/active` |
| S4-14 | Network failure → error, no false success, still `READY`; retry succeeds |
| S4-lost | Server started the exam but the response was lost → the page reconciles and moves on |
| S4-12 | 5 concurrent API starts → 1 start, 1 deadline, 1 audit event |
| S4-7..9 | `BLOCK` + pending review → `409` and redirect to Screen 3; another candidate → `404`; `ALLOW_PENDING_REVIEW` → startable with an honest status card |
| S4-17 | Back → Screen 3 read-only (camera off) → forward again |
| S4-layout | No horizontal scroll at 1536×1024, 1440×900, 1280×800, 1920×1080 |

### Infrastructure checks (run against real services)

| Command | What it proves | Status in this environment |
|---|---|---|
| `npm run verify:identity-infra` | Real S3: SSE-KMS, private object, Block Public Access, presigned URL expiry, deletion. Real ClamAV: EICAR detected, clean file passes | **BLOCKED** (no S3/MinIO, no ClamAV, Docker not running) |
| `npm run drill:backup` | Encrypted backup + restore into an isolated instance with identical data | Snapshot method **PASSED**; `mongodump` method **BLOCKED** (tools not installed); POSIX permission check N/A on Windows |
| `npm run worker:expiry -- --once` + `npm run ops:status` | The deployable worker closes an overdue exam; health goes degraded → ok | **PASSED** against an isolated, then dropped, database |

### Active exam — [`active.e2e.ts`](../e2e/active.e2e.ts)

| # | Scenario |
|---|---|
| A1 | Loads from the server: header, 12 questions, camera LIVE (real fake-device frames), mic ON, screen monitoring honestly Unavailable, timer = server deadline, visit recorded |
| A2 | The paper response has no correct-answer, topic or difficulty fields |
| A3 | Select → Save & Next persists; Mark for Review persists; refresh keeps position, answers, review state and the timer |
| A4 | Save failure keeps the selection, stays on the question, never shows "Saved"; Retry saves and moves on |
| A5 | Arrow keys don't change answers, Space selects; unsaved guard: Stay / Discard |
| A6 | Stopped camera track → Disconnected, server event + audit, alert shown; Reconnect → LIVE + restored event |
| A7 | Devices the policy doesn't require show Not Required and are never opened |
| A8 | Deadline → AUTO_SUBMITTED once, late answer write → `409`, camera released |
| A9 | End Exam → Submit dialog → SUBMITTED; repeat submit idempotent; one audit event |
| A10 | READY attempt: `/active` redirects to `/start`, paper → `409`; another candidate's paper → `404` |
| A11 | No horizontal overflow; Save is reachable at 1920×1080, 1536×1024, 1440×900, 1280×800 |

# 18 — External Candidate Exam Invite Portal

**Page:** `/invite` · **API:** `POST /api/invites/verify` · **Admin:** `npx tsx scripts/invite-admin.ts`
**Code:**
- [`src/server/invites/`](../src/server/invites/): service, API handler, tests
- [`src/components/invite/`](../src/components/invite/): page components
- [`src/types/invite.ts`](../src/types/invite.ts): shared types

Lets an exam coordinator admit a candidate who has **no Kodeversity LMS account**. Built as an **isolated, additive feature**: no existing component, route, API, schema, workflow or configuration was changed.

## Flow

1. **Coordinator creates an invite.** `npx tsx scripts/invite-admin.ts create <examCode> <email> "<Full Name>" [--hours 72] [--max 10]` prints a code like `KP-7KQM-X3HD` **once**.
2. **The candidate enters their details.** On `/invite` they enter their full name, email and invite code (the code's case, spaces and dashes don't matter).
3. **The server verifies the invite.** All three must match an `ACTIVE`, unexpired invite whose exam is published and inside its window.
4. **The server issues the same exam-scoped session the LMS launch issues.** It uses the existing `signCandidateToken` and `sessionCookie`, setting an `HttpOnly; SameSite=Lax` cookie (`Secure` on HTTPS or in production).
5. **The page navigates to `/exam/<examId>`.** The candidate continues through the existing, unchanged exam flow: system check, instructions, identity verification (if the exam requires it), start, and the exam itself.

## Security

| Concern | Handling |
|---|---|
| Code storage | Only `HMAC-SHA256(code)` is stored, keyed by HKDF from `KPROCTOR_AUTH_SECRET`. A database leak can't be brute-forced back into codes |
| Code space | `KP-` + 8 characters from 31 unambiguous symbols (no 0/O/1/I/L), about 8.5 × 10¹¹ codes, and a code also needs the matching email and name |
| Enumeration | Any mismatch (code, email or name) gets **one generic message**. Specific messages (expired, revoked, not open yet) only once all three match |
| Brute force | Rate limits: 30 attempts / 10 min per IP, 10 / 10 min per email |
| Re-entry | An invite can open a session up to `maxRedemptions` times (default 10) until it expires, so a candidate can come back after closing the browser |
| Window | An invite never outlives the exam (`expiresAt ≤ exam.endAt`), and only opens during `startAt…endAt` |
| Accounts | First use creates a dedicated candidate account (in a transaction, so concurrent first uses create exactly one). An **existing account with the same email (e.g. an LMS student) is never taken over** |
| Session | Scoped to the invited exam (the existing `exm` claim), so it can't open or start any other exam |
| Audit | Successes: `CANDIDATE_LAUNCHED { method: "INVITE", inviteId }`. Failures: `LAUNCH_REJECTED { method: "INVITE", reason }`. Neither ever contains the code |
| CSRF | The existing `assertSameOrigin` rejects cross-origin POSTs |

## Data

New collection `examInvites`:

```ts
{ _id, examId, codeHash, email /* lowercase */, fullName, nameKey, status: "ACTIVE" | "REVOKED",
  expiresAt, maxRedemptions, redemptions, candidateId, lastRedeemedAt, createdBy, createdAt, updatedAt }
```

**Indexes** (`codeHash` unique, `{examId, email}`, `{email, candidateId}`) are created by `ensureInviteIndexes()`. The admin script runs it before creating invites, so the indexes always exist before any invite can be used.

Candidates created by invites are ordinary `users` documents (`role: candidate`). No existing schema field was added.

## Admin

```bash
npx tsx scripts/invite-admin.ts create DEMO-101 priya@example.com "Priya Sharma" --hours 48
npx tsx scripts/invite-admin.ts list DEMO-101
npx tsx scripts/invite-admin.ts revoke <inviteId>
```

Send the code through a channel separate from the portal link.

## Tests

- **Server:** [`invite-service.test.ts`](../src/server/invites/invite-service.test.ts), 12 tests. It covers hashed storage, a scoped session for a new candidate, re-entry, code normalization, generic mismatch errors with audit, validation, expired/revoked/over-used invites, the exam window and draft exams, no takeover of existing accounts, concurrent first use, rate limits, the HttpOnly cookie with no token in the body, scope enforcement, and cross-origin rejection.
- **Browser:** `npx tsx e2e/invite-run.ts`, a separate runner, 4 scenarios. It covers rendering at 1536×1024, 1280×800 and 390×844 with no overflow and labelled inputs, client validation, a wrong invite giving no session, and a valid invite opening the exam flow.

## Not wired in (needs approval, since it would change existing files)

| Proposal | File | Change |
|---|---|---|
| Create invite indexes with `npm run db:indexes` | `src/server/db/indexes.ts` | One call to `ensureInviteIndexes(db)` |
| npm scripts `invite:create/list/revoke` | `package.json` | Three script entries |
| Run the invite suite with `npm run test:e2e` | `e2e/run.ts` | Import and call `runInviteSuite()` |
| Link this document | `documentation/README.md` | One index row |
| Show "Back to Login" and the student sign-in link | environment | Set `VITE_LMS_URL` (both are hidden or plain text without it) |

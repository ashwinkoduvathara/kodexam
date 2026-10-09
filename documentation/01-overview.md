# 01 — Overview

## What is KProctor?

KProctor is the examination and proctoring part of the Kodeversity ecosystem.
Candidates reach it from the LMS. Before an exam starts, they go through a guided flow:

```
1. System Check  →  2. Exam Instructions  →  3. Identity Verification  →  4. Start Exam
```

The goal is to feel like *"Kodeversity LMS + a secure examination environment"*: same brand, but more formal.

## Current scope

| Screen | Status | Notes |
|---|---|---|
| 1 — System Check | ✅ Complete, production-tested | Camera, microphone, speaker and network checks with real browser APIs |
| 2 — Exam Instructions | ✅ Complete | Server-backed acknowledgement, data from MongoDB |
| 3 — Identity Verification | ✅ Complete, awaiting approval | Photo + ID upload, encrypted storage, server-side decision, examiner review |
| 4 — Start Exam | ⏳ Placeholder route only | Shows "Start Exam — Coming next." |

**Not in scope yet:** exam questions, live proctoring, face detection, result calculation and the admin portal.

## Delivery history

### Phase 1 — Screen 1 first build
- Inspected the Kodeversity LMS (`../kodeversity`): TanStack Start, Tailwind v4, shadcn/ui (new-york), lucide and Plus Jakarta Sans.
- Created KProctor as a standalone app in this folder, using the same stack, versions and design tokens as the LMS.
- Built the exam shell: header, timer, stepper, support card and desktop-only gate.
- Built the System Check screen with real `getUserMedia`, Web Audio and network checks.

### Phase 2 — Screen 1 production hardening
- Added a central readiness store and a final `validateSystemReadiness()` check that probes the real devices, not just React state.
- Every check now has its full set of states (permission required, no device, device error, disconnected, timeout, no input, connection lost).
- Device switching, Permissions API support, automatic recovery and guaranteed media cleanup.
- Added the support dialog, an honest End Exam flow, the privacy note, accessibility work and an expiry state.
- 38 unit tests and 19 Chrome scenarios, run against both the dev and production builds.

### Phase 3 — Screen 2 + MongoDB foundation
- Added the MongoDB layer: official driver, a shared connection, typed collections, indexes and a seed script.
- Added the server-authoritative session API and candidate authentication (signed launch token → HttpOnly cookie).
- Replaced the frontend mock with `HttpExamSessionService`, so all data now comes from the server.
- Built the Exam Instructions screen from the reference design, with the acknowledgement stored on the server.
- Screen 1's Continue now saves results to the server and opens Screen 2; End Exam now really ends the attempt.
- Added the Identity Verification placeholder route.
- 68 unit/integration tests and 29 browser scenarios, all passing on both the dev and production builds.

### Phase 4 — Screen 3 Identity Verification (security-first)
- Added identity verification with an explicit, server-controlled state machine; client-supplied results are ignored.
- Every status change commits in a MongoDB transaction together with its audit event; reviewer decisions use optimistic concurrency.
- Added `IdentityDocumentStorage`: local AES-256-GCM envelope encryption (development) and an S3 provider with SSE-KMS and 60-second presigned URLs (production).
- Server-side upload validation (extension, MIME type and magic bytes must agree; dimensions; PDF active content), size limits, a ClamAV scanning hook (`SCAN_PENDING` when no scanner is configured), and rate limits backed by MongoDB.
- The government ID number is never collected (data minimisation). Candidates get minimal responses; examiners get audited, short-lived access.
- Added retention purge, nonce-based CSP and security headers, HTTPS enforcement, and sanitised logging.
- Local replica set tooling; the tests run on an ephemeral replica set.
- 116 unit/integration tests and 36 browser scenarios.

## Repository at a glance

```
Kodeexam/
├── documentation/      ← you are here
├── e2e/                Browser test suites (puppeteer-core + real Chrome)
├── scripts/            seed.ts, db-indexes.ts (development tooling)
├── src/
│   ├── components/     UI (exam shell, system-check, instructions, shadcn ui)
│   ├── hooks/          Device checks, readiness store, clock, permissions
│   ├── lib/exam/       Client domain logic + ExamSessionService
│   ├── routes/         Pages and REST endpoints (TanStack file routes)
│   ├── server/         MongoDB, repositories, services, auth (server-only)
│   └── types/          Types shared by client and server
├── .env.example
└── package.json
```

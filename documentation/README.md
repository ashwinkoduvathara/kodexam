# KProctor Documentation

These documents describe what has been built in KProctor so far, how it works, and how to run and test it.

| # | Document | What it covers |
|---|---|---|
| 01 | [Overview](01-overview.md) | What KProctor is, current scope, delivery history |
| 02 | [Getting Started](02-getting-started.md) | Setup, environment variables, seeding, running |
| 03 | [Architecture](03-architecture.md) | Stack, data flow, folder structure, key decisions |
| 04 | [Design System](04-design-system.md) | How KProctor reuses the Kodeversity LMS look |
| 05 | [Screen 1 — System Check](05-screen-1-system-check.md) | Device checks, readiness engine, cleanup |
| 06 | [Screen 2 — Exam Instructions](06-screen-2-exam-instructions.md) | UI, acknowledgement, routing guards |
| 07 | [Database](07-database.md) | MongoDB collections, documents, indexes, seed |
| 08 | [API Reference](08-api-reference.md) | REST endpoints, payloads, error codes |
| 09 | [Authentication & Security](09-authentication-security.md) | Launch tokens, cookies, ownership, CSRF, audit |
| 10 | [Exam Session & Timer](10-exam-session-and-timer.md) | Attempt lifecycle, status machine, server deadline |
| 11 | [Testing](11-testing.md) | Unit, integration and browser test suites |
| 12 | [Open Items & Decisions](12-open-items.md) | Known limitations and pending decisions |
| 13 | [Screen 3 — Identity Verification](13-screen-3-identity-verification.md) | Capture, upload, server decision, reviewer workflow |
| 14 | [Identity Data Security](14-identity-data-security.md) | Encryption, storage, scanning, access control, retention, every security assumption |
| 15 | [Screen 4 — Start Exam](15-screen-4-start-exam.md) | Final review, server-confirmed start, when the timer begins |
| 16 | [Active Exam](16-active-exam.md) | Questions, answers, camera, proctoring events, submission and timeout |
| 17 | [Operations](17-operations.md) | Deployment, environment variables, expiry worker, monitoring, backups, incident response |

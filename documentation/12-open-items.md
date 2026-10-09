# 12 — Open Items & Decisions

## Decisions needed

| # | Topic | Detail | Default today |
|---|---|---|---|
| 1 | **LMS sign-in (blocking)** | The LMS has no authentication implemented (no Firebase, no sessions). KProctor's Ed25519 launch flow is ready; the LMS must authenticate users server-side, then sign launches with `integrations/lms/kproctor-launch.ts` | Dev launch links only |
| 8 | **Event policy per exam** | Thresholds for warnings and human review; automatic termination stays off unless a trusted detection service exists | Warn from the 1st event, review from the 3rd |
| 2 | **Setup time limit** | The exam timer now starts only when the exam starts. Setup (Screens 1–3) is limited only by the exam window, so an abandoned setup stays resumable until the window closes. Add a separate setup limit if needed | No setup limit |
| 3 | **Support hours** | `VITE_SUPPORT_HOURS` is a placeholder not supplied by Kodeversity | "Monday to Saturday, 9:00 AM – 6:00 PM IST" |
| 4 | **Exam URLs** | Routes use `/exam/:examId/...` rather than `/student/exams/...` | `/exam/:examId/...` |
| 5 | **Identity verification method** | No automated face-match / document service exists, so every submission goes to manual review. Choose a provider, or staff examiner review | Manual review (`REVIEW_REQUIRED`) |
| 6 | **Identity review policy per exam** | `BLOCK` (wait for the examiner) or `ALLOW_PENDING_REVIEW` (start while under review) | `BLOCK` |
| 7 | **Retention periods** | Document/photo retention and audit-log retention must follow Kodeversity's privacy policy | 30 / 30 days; audit logs kept |

## Deliberate behaviour worth knowing

- **Repeat acknowledgements** return the current session instead of an error.
- **Another candidate's attempt** returns `404`, not `403`.
- **A `warning` system-check result** counts as passed.
- **Uploads require the photo first;** the document panel is locked until then.
- **One verification photo** is kept per attempt; retakes replace it.
- **Duplicate document uploads** (same file, same type) are no-ops.
- **A reviewer rejection after the candidate proceeded** (only possible under `ALLOW_PENDING_REVIEW`) marks the attempt's identity status `FAILED`. What that means for the running exam is a Screen 4+ decision.

## Known limitations

| Area | Limitation | What's needed |
|---|---|---|
| S3 storage | Failure paths tested against an unreachable endpoint; **never run against real S3/MinIO** (no Docker/services here) | `npm run verify:identity-infra` must PASS in staging |
| Malware scanning | Outage and timeout tested with real refused/hanging connections; **never run against a real clamd** | `npm run verify:identity-infra` must PASS (EICAR detection) |
| Backups | Snapshot backup/restore drilled in isolated instances; `mongodump` not installed here, Atlas backups not configured | Configure production backups and run a restore drill on them |
| Face detection | Only where the browser has a native `FaceDetector`; otherwise face checks are deferred to the reviewer | An ML detector, if client-side guidance is wanted |
| Examiner UI | Review happens through the API or `npm run identity:review` | An examiner portal (out of scope) |
| Transactions | Require a replica set; a local standalone MongoDB isn't enough | `npm run db:replset` locally; Atlas in production |
| AI face / gaze detection | No model is integrated; the page says "Face detection unavailable" and generates no AI alerts | Choose a provider |
| Screen monitoring | Not implemented; shown as Unavailable when the policy requires it | Decide if needed |
| Trusted detection source | Event policy is implemented, but all real events come from the untrusted browser, so they warn or flag but never terminate | A server-side detection service, if wanted |
| Expiry worker deployment | Implemented and tested; must be deployed and monitored | See [17 — Operations](17-operations.md) |
| Exam-scope on attempt endpoints | LMS sessions are scoped to one exam for opening/starting; attempt-level endpoints check ownership only (the candidate's own attempts) | Acceptable; revisit if needed |
| Other question types | Only single choice is implemented | When needed |
| Results / scoring | Not built (no score is calculated, no correct answers revealed) | After approval |
| Retention | Enforced only while `identity:purge` runs | Schedule it |
| Network speed | Not shown on localhost / private networks, by design | Network-test endpoints on the real exam server |
| Layout | At exactly 1536×1024 the Screen 3 footer sits ~50px below the fold (the consent bar isn't in the reference) | Accept, or move consent next to the button |

## Recommended hardening before production

See the full checklist in [14 — Identity Data Security](14-identity-data-security.md#15-production-checklist). In addition:

- Rate-limit `/api/auth/launch`. Identity endpoints are already rate-limited.
- Use a managed MongoDB with authentication, TLS and encrypted backups; least-privilege database user.
- Rotate `KPROCTOR_AUTH_SECRET` and KMS keys via a secret manager.
- Run `npm run db:indexes` on every deployment.

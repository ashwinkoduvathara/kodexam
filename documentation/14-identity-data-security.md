# 14 — Identity Data Security

This document states exactly what the implementation does to protect identity data, and every assumption it relies on.
If something isn't listed as enforced here, don't assume it is.

## 1. Data inventory and minimisation

| Data | Collected? | Where it lives | Protection |
|---|---|---|---|
| Live webcam stream | Viewed only | Candidate's browser memory | Never uploaded; stopped on leave / submit / unload |
| Verification photo (1 JPEG) | ✅ | Object storage | Encrypted at rest; one kept per attempt (retakes replace it) |
| Government ID document (JPG/PNG/PDF) | ✅ | Object storage | Encrypted at rest; never stored in MongoDB |
| **Government ID number** | ❌ **Never collected** | — | Not requested, not extracted (no OCR), not stored |
| Date of birth, phone, personal email | ❌ Not collected | — | — |
| ID type (e.g. "AADHAAR") | ✅ | MongoDB `identityVerifications` | Plaintext; not sensitive on its own |
| SHA-256 of photo and document | ✅ | MongoDB | Integrity only; not reversible to content |
| Candidate snapshot (name, roll number) | ✅ | MongoDB | Needed by the reviewer to compare against the ID |
| Verification result / reviewer decision | ✅ | MongoDB | Server-controlled; candidate sees a minimal summary |
| Uploaded file *name* | ❌ | — | Only the extension is sent, for validation |

## 2. Encryption — exactly what is encrypted

| What | How | Key |
|---|---|---|
| ID documents and photos (**production**: S3 provider) | S3 server-side encryption with KMS (`ServerSideEncryption: aws:kms`) | Customer-managed KMS key (`KPROCTOR_S3_KMS_KEY_ID`). Production refuses to start identity operations without it |
| ID documents and photos (**development**: local provider) | Application-level **envelope encryption**: a random AES-256-GCM data key per object, wrapped with a master key. The object key is bound as authenticated data, so ciphertexts can't be swapped | `KPROCTOR_IDENTITY_MASTER_KEY` in the git-ignored `.env.local`. **Development only.** |
| Data in transit | HTTPS. In production, identity endpoints reject non-HTTPS requests (`403 INSECURE_TRANSPORT`) except from loopback | TLS at the hosting layer |
| MongoDB fields | **None use field-level encryption** | Not needed: no sensitive identity *fields* are stored (see section 1) |

**About field-level encryption (CSFLE / Queryable Encryption).** No field currently needs it, because government ID numbers, date of birth, phone and personal email are not collected.

If a policy ever requires storing an ID number, it must be:
- stored with MongoDB **explicit CSFLE** (`AEAD_AES_256_CBC_HMAC_SHA_512-Random`) under a KMS-managed key, not queried, never returned by any API, and never logged
- or, preferably, replaced by `last4` + a keyed hash (HMAC with a KMS key) for matching

**Keys are never stored** in MongoDB, source code, committed files or browser storage, or next to the encrypted objects. The local master key exists only in the git-ignored `.env.local`.

## 3. Storage — `IdentityDocumentStorage`

Interface: `upload`, `getTemporaryAccess`, `delete`, `getMetadata`, `read`. See [`storage/types.ts`](../src/server/identity/storage/types.ts).

- **Object keys are random UUIDs** (`identity/document/<uuid>`) and contain no candidate data.
- **No permanent URLs exist.** MongoDB stores an opaque reference (`s3:…` / `local:…`), never a URL.
- **Signed access:** reviewers get a URL that expires after `KPROCTOR_IDENTITY_SIGNED_URL_TTL_SECONDS` (default 60).
  - S3: a presigned GET.
  - Local: an HMAC token (key derived from the master key with HKDF) that carries the expected SHA-256. The decrypted object is re-hashed and rejected on mismatch.
- Objects are served with `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, a `sandbox` CSP and `Referrer-Policy: no-referrer`.

**S3 bucket requirements.** These must be enforced in infrastructure; the code can't enforce them.
- Block Public Access fully enabled.
- Object Ownership "bucket owner enforced" (ACLs disabled).
- Default encryption SSE-KMS with a customer-managed key; key policy limited to the KProctor role.
- No public bucket policy; the app role can only Put/Get/Delete/Head under `identity/`.
- Versioning and lifecycle rules aligned with retention.
- Credentials come from the runtime IAM role, never from files.

> ⚠️ The S3 provider is **unit-level only**: it hasn't been exercised against a real S3 or MinIO, because Docker wasn't available. Test it against the target bucket before production.

## 4. Upload validation (server-side)

[`file-validation.ts`](../src/server/identity/file-validation.ts):

- The **declared extension, declared MIME type and actual magic bytes must all agree** (JPEG `FF D8 FF`, PNG signature, PDF `%PDF-`).
- **Images:** dimensions are parsed from the headers and must be between 300×200 and 12000×12000.
- **PDFs:** must end with `%%EOF`, and are rejected if they contain active content (`/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile`, `/RichMedia`, `/XFA`).
- **Rejected:** executables, HTML, SVG, archives, scripts and anything unknown.
- **Size:** `KPROCTOR_IDENTITY_MAX_DOCUMENT_MB` (default 5) and `…_MAX_PHOTO_MB` (default 2). The `Content-Length` is checked first and the stream is cut off at the limit, so oversized bodies are never fully buffered.
- Client-side checks exist only for friendliness; the server never relies on them.

## 5. Malware scanning

**Flow:** validate → scan (in memory) → store only if acceptable.

| Scanner result | Outcome |
|---|---|
| `CLEAN` | Stored, `scanStatus: CLEAN`, audit `DOCUMENT_SCAN_COMPLETED` |
| `INFECTED` | **Never stored**; candidate sees a generic rejection; audited |
| `ERROR` | **Never stored**; `503`, "try again"; audited |
| Not configured | Stored with `scanStatus: SCAN_PENDING`. It is **never shown as clean**; the candidate sees "security scan pending" and the result is routed to manual review |

- **Scanner:** ClamAV over the clamd `INSTREAM` protocol (`KPROCTOR_MALWARE_SCANNER=clamav`).
- **Production refuses to run without a scanner.**
- The ClamAV client is tested against a simulated daemon only (no ClamAV was available locally).

## 6. State machine and integrity

- Explicit states with a transition table that also records **who** may make each transition ([`state-machine.ts`](../src/server/identity/state-machine.ts)). The candidate can never cause `VERIFIED`, `FAILED` or `REVIEW_REQUIRED`.
- **Client-supplied results are ignored:** the verify endpoint reads only `consent`.
- **Every status change and its audit event commit in one MongoDB transaction** (majority write concern). A failed audit insert rolls the status change back; this is tested.
- **Optimistic concurrency:** each record has a `version`, and every update is conditional on the expected version and status. Two reviewers can't overwrite each other, and concurrent verify requests can't both run.
- **Transactions need a replica set.** On a standalone server, identity operations fail with `503` instead of writing non-atomically.
- A verification stuck in `PROCESSING` longer than `KPROCTOR_IDENTITY_PROCESSING_TIMEOUT_SECONDS` (default 120) is recovered to `REVIEW_REQUIRED`.

## 7. Access control

| Actor | Can | Cannot |
|---|---|---|
| Candidate (own attempt only) | Start, capture, upload, delete own document, verify (consent), retry, read own status summary | Read another attempt (404), view or download any document or photo, see hashes/references/URLs, read audit logs, set a status/result |
| Examiner (`role: proctor`) | Review verifications for exams listing them in `exam.examinerIds`; get 60-second signed URLs; approve/reject | Access other exams (404) |
| Admin (`role: admin`) | Review any verification | — |

Identity always comes from the signed session token; roles come from the `users` collection. Mutations require same-origin requests.

## 8. Audit trail

Records go to `auditLogs`: `{ _id, eventType, timestamp, actorType, actorId, attemptId, examId, candidateId, ipAddress, userAgent, metadata }`.

- **Identity events:** `IDENTITY_VERIFICATION_STARTED`, `CAMERA_CAPTURED`, `DOCUMENT_UPLOADED`, `DOCUMENT_REJECTED`, `DOCUMENT_SCAN_COMPLETED`, `DOCUMENT_DELETED`, `DOCUMENT_VIEWED`, `PHOTO_VIEWED`, `IDENTITY_VERIFICATION_PROCESSING`, `IDENTITY_VERIFIED`, `IDENTITY_FAILED`, `IDENTITY_REVIEW_REQUIRED`, `IDENTITY_VERIFICATION_RETRY`, `IDENTITY_VERIFICATION_EXPIRED`, `IDENTITY_DATA_PURGED`.
- **Metadata** holds only statuses, codes, sizes and types. **Never** document contents, images, frames, ID numbers, tokens or URLs (tested).
- **Timestamps** are server-generated BSON Dates (UTC). `_id` (ObjectId) is the unique event ID and the tie-breaker for ordering.

## 9. Retention and deletion

| Setting | Default |
|---|---|
| `KPROCTOR_IDENTITY_DOCUMENT_RETENTION_DAYS` | 30 |
| `KPROCTOR_IDENTITY_PHOTO_RETENTION_DAYS` | 30 |
| `KPROCTOR_AUDIT_RETENTION_DAYS` | Unset = keep. If set, a TTL index on `auditLogs.timestamp` is applied by `db:indexes` |

- **`npm run identity:purge`** deletes expired objects, clears their metadata and records `IDENTITY_DATA_PURGED`. **Retention is only enforced while this job runs, so schedule it** (e.g. hourly).
- **Deletion semantics:**
  - S3 deletes the object; with versioning enabled, a lifecycle rule must expire noncurrent versions.
  - Local storage deletes the encrypted file. Its wrapped data key is in the same file, so the content becomes unrecoverable without a disk-level copy plus the master key. That is cryptographic deletion, not physical overwrite.
- Retakes, replacements, deletions and retries remove the previous object immediately. If deleting a *replaced* object fails, it's logged (by attempt ID) for operator cleanup.

## 10. Logging

The server logs only identifiers, event names, statuses and error *names/codes* ([`log.ts`](../src/server/log.ts)).

It never logs: request bodies, documents, images, ID numbers, tokens, signed URLs, connection strings or keys. Unhandled errors are logged by name and code only, because error messages can embed data.

## 11. Browser side

- No identity data is put in `localStorage`, `sessionStorage` or IndexedDB (tested).
- Captured photos and selected files are previewed via in-memory object URLs, revoked on unmount.
- Uploads are raw request bodies; nothing goes in URLs or query strings (tested).
- The live camera is unmounted (tracks stopped) as soon as the submission is under review or decided, and on route leave or page unload.
- `window.isSecureContext` is required, or "Secure connection required" is shown.

## 12. Security headers

These are set on every response by the request middleware ([`src/start.ts`](../src/start.ts)):

| Header | Value |
|---|---|
| `Content-Security-Policy` | Production builds only: per-request **nonce** for scripts, `frame-ancestors 'none'`, `object-src 'none'` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `Permissions-Policy` | `camera=(self), microphone=(self), …` and everything else off |
| `X-Frame-Options` | `DENY` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Strict-Transport-Security` | On HTTPS |

CSP is off in `vite dev`, because hot-reload injects inline scripts. `style-src` allows `'unsafe-inline'` for style *attributes* used by layout primitives; scripts are nonce-only.

## 13. Rate limiting

A fixed-window limiter stored in MongoDB (`rateLimits`, TTL-indexed), so it holds across instances.

- **Per candidate and attempt:** capture, upload/delete, verify, retry, status.
- **Per reviewer:** evidence access.
- The response is a generic "Too many attempts…" (`429`) that doesn't reveal the limits.
- All limits are configurable (see `.env.example`).

## 14. Backups

Backups aren't managed by this codebase. Requirements for operators:

- **MongoDB:** use encrypted managed backups (e.g. Atlas Cloud Backup) with separate, restricted credentials, a retention policy and access auditing. Never produce plaintext `mongodump` files. MongoDB holds no documents or images, only metadata.
- **Object storage:** bucket versioning/replication must use the same KMS protection and lifecycle rules. Deleted objects must also expire from backups within the retention policy.

## 15. Production checklist

Production (`NODE_ENV=production`) **refuses** identity operations unless the first three items are configured.

- [ ] `KPROCTOR_IDENTITY_STORAGE=s3` with a private bucket meeting section 3, and `KPROCTOR_S3_KMS_KEY_ID` set
- [ ] `KPROCTOR_MALWARE_SCANNER=clamav` with a reachable clamd
- [ ] MongoDB replica set (Atlas) with auth + TLS
- [ ] HTTPS everywhere; `KPROCTOR_TRUST_PROXY=true` only behind a trusted proxy
- [ ] `identity:purge` scheduled; `db:indexes` run on deploy
- [ ] Secrets (auth secret, KMS access) supplied by a secret manager, not files
- [ ] S3 provider and ClamAV integration tested against real services
- [ ] A real identity-verification provider, or staffed manual review, with an `identityReviewPolicy` chosen per exam

# 07 — Database (MongoDB)

## Connection — [`src/server/db/mongodb.ts`](../src/server/db/mongodb.ts)

- Uses the official `mongodb` driver (7.5.0).
- **One `MongoClient` per process,** cached on `globalThis` so Vite reloads in development reuse it instead of opening new pools.
- Pool size 20; 5 second server-selection and connect timeouts.
- A failed connection isn't cached; the next request retries.
- Errors surface as `DatabaseUnavailableError` (API → `503 SERVICE_UNAVAILABLE`). The message **never includes the connection string**.
- Configuration comes from `MONGODB_URI` and `MONGODB_DB_NAME` (default `kodeproctor`). See [02 — Getting Started](02-getting-started.md).

| Database | Purpose |
|---|---|
| `kodeproctor` | Development / application data |
| `kodeproctor_test` | Automated tests. Dropped between tests; the helper refuses to drop any database not ending in `_test` |

## Collections — [`src/server/db/collections.ts`](../src/server/db/collections.ts)

| Collection | Used by | Purpose |
|---|---|---|
| `users` | ✅ | Candidates (and later admins/proctors) |
| `exams` | ✅ | Exam definitions and policies |
| `examAttempts` | ✅ | One document per attempt; the lifecycle state |
| `examSessions` | ✅ | Policy and deadline snapshot frozen when an attempt starts |
| `auditLogs` | ✅ | Security-relevant events |
| `questions` | ✅ | Exam questions, in `order`; `correctOptionIds` is server-only |
| `proctoringEvents` | ✅ | Browser-observed events during the exam (server time, server severity) |
| `candidateAnswers` | ✅ | One per (attempt, question): answer, review flag, visit, `answerVersion` |
| `identityVerifications` | ✅ | Screen 3: one per attempt (metadata + opaque storage references only) |
| `supportTickets` | Defined | Future: support requests |
| `rateLimits` | ✅ | Fixed-window rate-limit counters (TTL) |
| `launchTokens` | ✅ | Used LMS launch-token ids (SHA-256 of `iss` + `jti`), TTL-expired: replay prevention |
| `workerStatus` | ✅ | Expiry-worker heartbeat / last result / failures, read by the ops health check |

### `exams`

```ts
{
  _id, examCode, name, description,
  durationMinutes, totalQuestions, totalMarks, passingMarks, attemptLimit,
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED",
  instructions: [{ id, title, description, icon }],
  proctoringPolicy: { cameraRequired, microphoneRequired, screenMonitoringRequired,
                      fullscreenRequired, identityVerificationRequired },
  securityPolicy:   { allowTabSwitch, allowExternalDevices, allowBackNavigation,
                      allowPause, autoSubmitOnExpiry },
  startAt, endAt,            // exam window
  createdBy, createdAt, updatedAt
}
```

### `examAttempts`

```ts
{
  _id, examId, candidateId, attemptNumber,
  status,                    // see 10-exam-session-and-timer.md
  startedAt,                 // attempt (setup) opened; the exam timer does NOT start here
  examStartedAt,             // exam started (READY → IN_PROGRESS); null during setup
  expiresAt,                 // setup: exam.endAt · started: min(examStartedAt + duration, exam.endAt)
  submittedAt, cancelledAt,
  systemCheck: { camera, microphone, speaker, network, completedAt },
  instructionsAcknowledgedAt,
  identityVerification: { status, completedAt },
  createdAt, updatedAt
}
```

### `examSessions`

```ts
{ _id, attemptId, examId, candidateId, examEndTime, requiredChecks,
  proctoringPolicy, securityPolicy, lastSeenAt, createdAt, updatedAt }
```

### `auditLogs`

```ts
{ _id, eventType, timestamp, actorType: "CANDIDATE" | "REVIEWER" | "SYSTEM", actorId,
  attemptId, examId, candidateId, ipAddress, userAgent, metadata }
```

| Event | When |
|---|---|
| `ATTEMPT_STARTED` | A new attempt is created |
| `SYSTEM_CHECK_COMPLETED` | System check results are recorded (results stored in `metadata`) |
| `INSTRUCTIONS_ACKNOWLEDGED` | The candidate acknowledges the instructions |
| `ATTEMPT_CANCELLED` | The candidate ends the exam |
| `EXAM_STARTED` | The candidate starts the exam and the timer begins (metadata: duration, deadline) |
| `EXAM_SUBMITTED` | The candidate submits (End Exam); metadata: answered count |
| `EXAM_AUTO_SUBMITTED` | The deadline passed and the server auto-submitted |
| `PROCTORING_EVENT_RECORDED` | A proctoring event was recorded (type, severity, source) |
| `ATTEMPT_EXPIRED` | The server marks an attempt expired |

Only the IP address and a user agent truncated to 256 characters are stored; nothing else sensitive.

### `identityVerifications`

```ts
{
  _id, attemptId, candidateId, examId,
  status,                  // NOT_STARTED … VERIFIED / FAILED / REVIEW_REQUIRED / EXPIRED
  version,                 // optimistic concurrency
  verificationMethod, capturedAt, verifiedAt,
  photo:      { reference, sha256, sizeBytes, width, height, storageProvider, capturedAt, expiresAt } | null,
  idDocument: { documentType, documentReference, documentHash, fileType, sizeBytes,
                storageProvider, scanStatus, scannedAt, uploadedAt, expiresAt } | null,
  candidateSnapshot: { name, rollNumber },
  verificationResult: { faceMatch, documentValid, documentReadable, verificationScore,
                        reviewRequired, provider, reason } | null,
  reviewer: { reviewerId, reviewedAt, decision } | null,
  consentAt, processingStartedAt, retryCount, lastError, dataExpiresAt, purgedAt,
  createdAt, updatedAt
}
```

`reference` / `documentReference` are opaque storage keys (random UUIDs), **not URLs**. No government ID number, document bytes or images are ever stored here. See [14 — Identity Data Security](14-identity-data-security.md).

### `questions`

```ts
{ _id, examId, order, sectionId, type: "SINGLE_CHOICE" | …, prompt,
  options: [{ id, text }], correctOptionIds /* never sent to candidates */,
  marks, topic, difficulty, createdAt, updatedAt }
```

Exams list their sections in `exams.sections: [{ id, title }]`.

### `candidateAnswers`

```ts
{ _id, attemptId, examId, candidateId, questionId,
  selectedOptionIds, markedForReview, visitedAt /* absent until viewed */,
  answerVersion, lastRequestId, savedAt, createdAt, updatedAt }
```

Unique index `{ attemptId: 1, questionId: 1 }`. See [16 — Active Exam](16-active-exam.md) for the concurrency rules.

### `proctoringEvents`

```ts
{ _id, attemptId, examId, candidateId, type, severity, occurredAt /* server time */,
  source: "BROWSER", metadata, createdAt }
```

### `examAttempts` additions

`closedReason` (`CANDIDATE` / `TIME_LIMIT` / `POLICY_TERMINATION`), `expiryLease { by, until }` (expiry-worker claim), `review { required, reasons, flaggedAt }` (event policy), `lastAnswerAt` (answer write fence). Index `status_expiresAt` serves the expiry worker.

### `users`

`lmsUserId` (unique, partial) maps a Kodeversity LMS user to a candidate.

`proctor` (examiner) and `admin` users can review identity verifications. Examiners only see exams that list them in `exams.examinerIds`.

```ts
{ _id, role: "candidate" | "admin" | "proctor", name, email, rollNumber,
  avatarUrl, status: "ACTIVE" | "DISABLED", createdAt, updatedAt }
```

## Transactions — [`src/server/db/transactions.ts`](../src/server/db/transactions.ts)

`withTransaction()` runs multi-document ACID transactions (snapshot read concern, majority write concern). Identity status changes always commit together with their audit event. **A replica set is required**; on a standalone server identity operations return `503` rather than writing non-atomically.

## Indexes — [`src/server/db/indexes.ts`](../src/server/db/indexes.ts)

Created by `npm run db:indexes` or `npm run db:seed`, never during requests.

| Collection | Index | Options | Query it serves |
|---|---|---|---|
| `users` | `{ rollNumber: 1 }` | unique, partial (string) | Candidate lookup |
| `users` | `{ email: 1 }` | unique, partial (string) | Candidate lookup |
| `exams` | `{ examCode: 1 }` | unique | Exam by code |
| `examAttempts` | `{ examId: 1, candidateId: 1, attemptNumber: 1 }` | **unique** | Latest attempt; prevents duplicate attempts under concurrency |
| `examAttempts` | `{ candidateId: 1, status: 1 }` | — | A candidate's active attempts |
| `examSessions` | `{ attemptId: 1 }` | unique | Snapshot per attempt |
| `auditLogs` | `{ attemptId: 1, timestamp: -1 }` | — | Audit trail of an attempt |
| `auditLogs` | `{ timestamp: 1 }` | TTL, only if `KPROCTOR_AUDIT_RETENTION_DAYS` is set | Audit retention |
| `identityVerifications` | `{ attemptId: 1 }` | unique | One verification per attempt (also blocks concurrent duplicates) |
| `identityVerifications` | `{ candidateId: 1, createdAt: -1 }` | — | A candidate's verifications |
| `identityVerifications` | `{ examId: 1, status: 1 }` | — | Reviewer queue |
| `identityVerifications` | `{ dataExpiresAt: 1 }` | partial (date) | Retention purge |
| `rateLimits` | `{ expiresAt: 1 }` | TTL | Expire counters |
| `questions` | `{ examId: 1, order: 1 }` | unique | Questions in order |
| `proctoringEvents` | `{ attemptId: 1, occurredAt: 1 }` | — | Event timeline |
| `supportTickets` | `{ candidateId: 1, createdAt: -1 }` | — | A candidate's tickets |

## Repositories — `src/server/repositories/`

| Repository | Key operations |
|---|---|
| `user-repository` | `findActiveCandidate(id)` |
| `exam-repository` | `findById`, `findByCode`, `findByRef` (ObjectId or exam code) |
| `exam-attempt-repository` | `findLatest`, `findOwned` (ownership in the query), `insert`, **`transition`** (atomic conditional update), `expireIfDue` |
| `exam-session-repository` | `ensure` (create the snapshot once), `findByAttempt` |
| `audit-log-repository` | `record`, `listForAttempt` |

`transition()` applies only if the attempt belongs to the candidate, is in an allowed status and hasn't expired. That makes concurrent requests safe without transactions.

## Seed — [`scripts/seed.ts`](../scripts/seed.ts)

Development only. It upserts by `rollNumber` / `examCode`, so re-running never creates duplicates. See [02 — Getting Started](02-getting-started.md).

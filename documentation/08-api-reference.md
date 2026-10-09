# 08 — API Reference

All endpoints return JSON with `Cache-Control: no-store`.
Authentication uses the `kp_session` cookie (set by `/api/auth/launch`) or `Authorization: Bearer <token>`.
POST endpoints reject cross-origin requests.

Route files live in `src/routes/api/**`; the handlers are in [`src/server/api/exam-api.ts`](../src/server/api/exam-api.ts).

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET / POST | `/api/auth/lms-launch` | **Production launch:** single-use Ed25519 LMS token → exam-scoped session cookie → 302 into the exam |
| GET | `/api/auth/launch?token=…&next=/exam/<id>` | Development launch link (refused in production unless `KPROCTOR_ALLOW_DEV_LAUNCH=true`) |
| GET | `/api/ops/health` | Expiry-job health (Bearer `KPROCTOR_OPS_TOKEN`; 404 when unset; 200 ok / 503 degraded) |
| GET | `/api/exams/:examId/session` | The candidate's latest attempt and session for this exam |
| POST | `/api/exams/:examId/attempts` | Start an attempt (idempotent) |
| GET | `/api/exam-attempts/:attemptId` | Attempt details |
| POST | `/api/exam-attempts/:attemptId/system-check` | Record system check results |
| POST | `/api/exam-attempts/:attemptId/instructions/acknowledge` | Acknowledge the instructions |
| POST | `/api/exam-attempts/:attemptId/start-exam` | Start the exam: `READY → IN_PROGRESS`; **the exam timer starts here** |
| POST | `/api/exam-attempts/:attemptId/end` | Candidate ends the attempt |
| GET | `/api/exam-attempts/:attemptId/identity/status` | Candidate's minimal identity status |
| POST | `/api/exam-attempts/:attemptId/identity/start` | Start verification (idempotent) |
| POST | `/api/exam-attempts/:attemptId/identity/capture` | Upload the one verification photo (raw `image/jpeg` body) |
| POST | `/api/exam-attempts/:attemptId/identity/document` | Upload the ID (raw body; `Content-Type`, `X-File-Extension`, `X-Document-Type` headers) |
| DELETE | `/api/exam-attempts/:attemptId/identity/document` | Remove the uploaded ID |
| POST | `/api/exam-attempts/:attemptId/identity/verify` | Submit for verification. Body `{ consent: true }`; anything else is ignored |
| POST | `/api/exam-attempts/:attemptId/identity/retry` | Start over after FAILED (limited) |
| GET | `/api/review/identity-verifications/:verificationId` | Examiner/admin: review summary |
| POST | `/api/review/identity-verifications/:verificationId/access` | Examiner/admin: 60-second signed URL for `{ asset: "document" \| "photo" }` (audited) |
| POST | `/api/review/identity-verifications/:verificationId/decision` | Examiner/admin: `{ decision: "APPROVE" \| "REJECT", expectedVersion }` |
| GET | `/api/identity-objects/:token` | Signed, expiring object download (local storage provider) |
| GET | `/api/exam-attempts/:attemptId/paper` | Running exam: sections, ordered questions (no correct answers), answer state |
| POST | `/api/exam-attempts/:attemptId/answers/:questionId` | Save an answer / review flag / visit (versioned) |
| POST | `/api/exam-attempts/:attemptId/submit` | Submit the running exam (idempotent) |
| GET / POST | `/api/exam-attempts/:attemptId/proctoring-events` | List / record browser-observed events. POST returns `{ event, notice, examEnded }`; `notice` is a neutral instruction chosen by the event policy |
| GET | `/api/network-test/ping` | Latency probe |
| GET | `/api/network-test/download?bytes=N` | Download sample (max 16 MB) |
| POST | `/api/network-test/upload` | Upload sample (max 16 MB) |

`:examId` accepts the exam's ObjectId (canonical) or its exam code (e.g. `CN-2041`).

## Session response

Returned by the session, attempts, system-check and acknowledge endpoints ([`src/types/api.ts`](../src/types/api.ts)):

```json
{
  "exam": {
    "id": "6ac7…097", "code": "CN-2041", "name": "Computer Network", "description": "…",
    "durationMinutes": 90, "totalQuestions": 50, "totalMarks": 100, "passingMarks": 40,
    "attemptLimit": 1, "instructions": [{ "id": "…", "title": "…", "description": "…", "icon": "monitor" }]
  },
  "candidate": { "id": "6ac7…096", "name": "Jaydeep Das", "rollNumber": "123456789", "avatarUrl": null },
  "attempt": {
    "id": "6ac7…ea3", "attemptNumber": 1, "status": "INSTRUCTIONS",
    "startedAt": "2026-10-08T11:46:30.798Z", "examStartedAt": null,
    "expiresAt": "2026-11-07T11:46:30.798Z",
    "systemCheckCompletedAt": "…", "instructionsAcknowledgedAt": null
  },
  "proctoringPolicy": { "cameraRequired": true, "microphoneRequired": true,
    "screenMonitoringRequired": true, "fullscreenRequired": true, "identityVerificationRequired": true },
  "securityPolicy": { "allowTabSwitch": false, "allowExternalDevices": false,
    "allowBackNavigation": false, "allowPause": false, "autoSubmitOnExpiry": true },
  "requiredChecks": ["camera", "microphone", "speaker", "network"],
  "serverTime": "2026-10-08T11:50:00.000Z"
}
```

## Endpoint rules

### `GET /api/exams/:examId/session`
- `404 NO_ATTEMPT` if the candidate has no attempt yet (the client then calls POST attempts).
- `403 EXAM_NOT_ACTIVE` if the exam isn't published or (with no attempt) is outside its window.
- Pre-exam attempts past `expiresAt` are marked `EXPIRED` on read.

### `POST /api/exams/:examId/attempts`
- **Idempotent:** returns the open attempt if one exists. Concurrent calls create only one.
- New attempts start at `SYSTEM_CHECK`, with `examStartedAt: null` and `expiresAt = exam.endAt`. The exam timer doesn't run during setup.
- `409 ATTEMPT_LIMIT_REACHED` when `attemptLimit` is used up.
- Returns `201`.

### `POST /api/exam-attempts/:attemptId/system-check`
Request body:
```json
{ "results": { "camera": "passed", "microphone": "passed", "speaker": "passed", "network": "warning" } }
```
- Allowed from `SYSTEM_CHECK`, `INSTRUCTIONS`, `IDENTITY_VERIFICATION` and `READY`.
- Every **required** check must be `passed` or `warning`, otherwise `422 VALIDATION_ERROR`.
- `SYSTEM_CHECK` → `INSTRUCTIONS`; later statuses are kept (re-checks don't move the status backwards).

### `POST /api/exam-attempts/:attemptId/instructions/acknowledge`
- Must be at `INSTRUCTIONS`, otherwise `409 INVALID_STATE`.
- Expired → `409 ATTEMPT_EXPIRED`, and the attempt is marked `EXPIRED`.
- Sets `instructionsAcknowledgedAt` and the status to `IDENTITY_VERIFICATION`, or `READY` if identity verification isn't required.
- **Idempotent:** a repeat after success returns the current session without a second audit event.

### `POST /api/exam-attempts/:attemptId/start-exam`
- Must be at `READY` (all pre-exam steps done), otherwise `409 INVALID_STATE`. The server also re-checks the recorded facts: system check completed, instructions acknowledged, and identity allowed by the frozen policy.
- Exam archived or outside its window → `403 EXAM_NOT_ACTIVE`.
- The request body is ignored; nothing about timing is accepted from the browser.
- The update, snapshot deadline and `EXAM_STARTED` audit event commit in one transaction (replica set).
- Sets `status: IN_PROGRESS`, `examStartedAt: now` and `expiresAt = min(now + duration, exam.endAt)`, so the full duration applies however long setup took. Records `EXAM_STARTED`.
- **Idempotent:** a repeat (or a concurrent call) returns the running exam with its original deadline and no second audit event.
- Exam window closed → `409 ATTEMPT_EXPIRED`. Another candidate's attempt → `404`.

### `POST /api/exam-attempts/:attemptId/end`
- Allowed in pre-exam statuses → `CANCELLED`. Returns `{ ended: true, session }`.

## Identity responses

The candidate status response contains only what the UI needs:

```json
{
  "status": "REVIEW_REQUIRED",
  "photo": { "captured": true, "capturedAt": "…" },
  "document": { "present": true, "documentType": "AADHAAR", "fileType": "PNG",
                "scanStatus": "SCAN_PENDING", "uploadedAt": "…" },
  "result": { "faceMatch": null, "documentValid": null, "reviewRequired": true },
  "canProceed": false,
  "retriesRemaining": 2,
  "lastError": null,
  "limits": { "maxDocumentBytes": 5242880, "maxPhotoBytes": 2097152, "acceptedFormats": ["JPEG","PNG","PDF"] },
  "retention": { "documentDays": 30, "photoDays": 30 },
  "serverTime": "…"
}
```

It never contains storage references, hashes, URLs, reviewer identity or file contents (tested). Full rules: [13 — Screen 3](13-screen-3-identity-verification.md) and [14 — Identity Data Security](14-identity-data-security.md).

## Errors

```json
{ "error": { "code": "ATTEMPT_EXPIRED", "message": "Exam session has expired." } }
```

Messages are written for candidates; internal details are only logged on the server.

| HTTP | Code | Meaning |
|---|---|---|
| 400 / 413 | `VALIDATION_ERROR` | Invalid JSON / body over 16 KB |
| 401 | `UNAUTHENTICATED` | Missing, invalid or expired session |
| 403 | `FORBIDDEN` | Cross-origin request blocked |
| 403 | `EXAM_NOT_ACTIVE` | Exam not open |
| 404 | `NOT_FOUND` | Exam or attempt not found **(also returned for another candidate's attempt)** |
| 404 | `NO_ATTEMPT` | No attempt started yet |
| 409 | `ATTEMPT_LIMIT_REACHED` | No attempts left |
| 409 | `ATTEMPT_EXPIRED` | Deadline passed |
| 409 | `INVALID_STATE` | Action not allowed in the current status / concurrent change |
| 409 | `ANSWER_CONFLICT` | The answer changed since the client read it; `error.details.answer` has the current state |
| 409 | `ATTEMPT_SUBMITTED` | The exam was submitted or timed out; answers are locked |
| 403 | `INSECURE_TRANSPORT` | Identity request over plain HTTP in production |
| 413 | `PAYLOAD_TOO_LARGE` | Upload over the configured limit |
| 415 | `UNSUPPORTED_DOCUMENT` | Wrong type, or extension/MIME/signature mismatch |
| 422 | `DOCUMENT_REJECTED` | Unreadable, unsafe (e.g. PDF JavaScript) or infected file |
| 429 | `RATE_LIMITED` | Too many attempts (limits not disclosed) |
| 422 | `VALIDATION_ERROR` | Required checks not passed |
| 503 | `SERVICE_UNAVAILABLE` | Database unavailable |
| 500 | `INTERNAL` | Unexpected error |

## Client: `ExamSessionService`

[`exam-session-service.ts`](../src/lib/exam/session/exam-session-service.ts) is the only way the UI talks to the API:

```ts
interface ExamSessionService {
  openSession(examId): Promise<ExamSession>;        // GET session, or start the first attempt
  getSession(examId): Promise<ExamSession>;
  startAttempt(examId): Promise<ExamSession>;
  startExam(attemptId): Promise<ExamSession>;      // READY → IN_PROGRESS; the timer starts
  getAttempt(attemptId): Promise<ExamAttemptResponse>;
  submitSystemCheck(attemptId, summary): Promise<ExamSession>;
  acknowledgeInstructions(attemptId): Promise<ExamSession>;
  endExamAttempt(attemptId): Promise<EndAttemptResult>;
}
```

Failures throw `ExamApiError` with `code`, `status` and a safe `message`. Network failures become `SERVICE_UNAVAILABLE`.

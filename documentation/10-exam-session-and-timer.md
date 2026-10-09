# 10 — Exam Session & Timer

## Attempt statuses — [`src/types/exam-attempt.ts`](../src/types/exam-attempt.ts)

```ts
ATTEMPT_STATUS = {
  NOT_STARTED, SYSTEM_CHECK, INSTRUCTIONS, IDENTITY_VERIFICATION, READY,
  IN_PROGRESS, SUBMITTED, AUTO_SUBMITTED, EXPIRED, CANCELLED
}
```

| Group | Statuses |
|---|---|
| Pre-exam | `NOT_STARTED`, `SYSTEM_CHECK`, `INSTRUCTIONS`, `IDENTITY_VERIFICATION`, `READY` |
| Active | Pre-exam + `IN_PROGRESS` |
| Terminal | `SUBMITTED`, `AUTO_SUBMITTED`, `EXPIRED`, `CANCELLED` |

Constants are used everywhere instead of raw strings.

## Lifecycle (implemented so far)

```
                POST attempts
                     │
                     ▼
              ┌─────────────┐  POST system-check   ┌──────────────┐  POST acknowledge  ┌───────────────────────┐
              │ SYSTEM_CHECK │ ───────────────────▶ │ INSTRUCTIONS │ ─────────────────▶ │ IDENTITY_VERIFICATION │
              └─────────────┘                      └──────────────┘   (or READY if    └───────────────────────┘
                     │                                    │           identity isn't
                     │                                    │           required)
                     ▼                                    ▼
          deadline passed → EXPIRED          POST end → CANCELLED   (any pre-exam status)
```

**Starting the exam:** `POST /api/exam-attempts/:attemptId/start-exam` moves `READY → IN_PROGRESS`. This is the only place the exam timer starts (see [Timer](#timer)). It is idempotent, and it records `EXAM_STARTED`. Screen 4's **Start Exam** button calls it; see [15 — Screen 4](15-screen-4-start-exam.md).

**Identity verification** (Screen 3) moves `IDENTITY_VERIFICATION → READY` when the server verifies the identity, or when it's under review and the exam's `identityReviewPolicy` is `ALLOW_PENDING_REVIEW`. Its own state machine is documented in [14 — Identity Data Security](14-identity-data-security.md#6-state-machine-and-integrity).

`IN_PROGRESS` is reached through `start-exam`. A running exam ends as:
- `SUBMITTED` through `POST /submit` (End Exam)
- `AUTO_SUBMITTED` when the deadline passes and `autoSubmitOnExpiry` is on
- `EXPIRED` when the deadline passes and `autoSubmitOnExpiry` is off

The first request after the deadline closes it, once, with an audit event. See [16 — Active Exam](16-active-exam.md#submission-and-timeout).

## Routing by status — [`src/lib/exam/steps.ts`](../src/lib/exam/steps.ts)

| Server status | Route |
|---|---|
| `NOT_STARTED`, `SYSTEM_CHECK` | `/exam/:examId/system-check` |
| `INSTRUCTIONS` | `/exam/:examId/instructions` |
| `IDENTITY_VERIFICATION` | `/exam/:examId/identity-verification` |
| `READY` | `/exam/:examId/start` (Screen 4) |
| `IN_PROGRESS` | `/exam/:examId/active` (running-exam placeholder). Every preparation URL redirects here |
| Terminal | The shell shows the closed-attempt notice |

- `/exam/:examId` redirects to the right step.
- Screen 2 forwards when the attempt is already acknowledged.
- Screens 3 and 4 send the candidate back if they arrive too early. Back from Screen 4 opens Screen 3 read-only (`?revisit=true`).
- Completed steps in the stepper come from server timestamps (`systemCheckCompletedAt`, `instructionsAcknowledgedAt`), so they survive refreshes.

## Session loading — [`src/routes/exam/$examId.tsx`](../src/routes/exam/$examId.tsx)

- `ssr: false`: the loader runs in the browser and calls `ExamSessionService.openSession(examId)`.
- **No attempt yet:** the service starts one (`POST attempts`).
- **Error:** shows a safe error screen (not signed in, exam not found, exam not open, no attempts left, server unavailable with Try Again).
- **After a mutation:** the server's returned session replaces the local copy (`applySession`).
- **Refresh:** reloads everything from the server, so session, attempt, acknowledgement and timer are all preserved.

## Timer — [`use-exam-clock.ts`](../src/hooks/use-exam-clock.ts)

**The exam timer starts only when the exam starts, not during setup.** Time spent on the system check, instructions and identity verification never counts against the exam duration.

| Phase | `expiresAt` (server) | Header shows |
|---|---|---|
| Setup (Screens 1–3, `READY`) | `exam.endAt`: setup is limited only by the exam window | **Exam Duration**, frozen at the full duration (e.g. `01:15:00`, "starts with exam") |
| Exam started (`IN_PROGRESS`) | `min(examStartedAt + durationMinutes, exam.endAt)`, set by `start-exam` | **Time Remaining**, counting down |

- **Source of truth:** `attempt.expiresAt` and `attempt.examStartedAt` from the server, never local storage or a start time and duration the client works out itself.
- `remaining = expiresAt − Date.now()`, recomputed every second and whenever the tab becomes visible again. It never goes below zero.
- **During setup**, if the exam window closes sooner than the full duration, the header shows the shorter time the candidate would actually get. It counts down, and the warning colours apply.
- `startedAt` is when the attempt (setup) was opened. `examStartedAt` is when the exam itself began.

| Remaining | Display |
|---|---|
| > 10 min | Normal (green) |
| ≤ 10 min | Amber |
| ≤ 5 min | Red |
| 0 | "Session Expired"; Continue disabled; Screen 1 releases the camera and mic |

The colours apply while the exam is running, and during setup only when the exam window is closing.

On the server, any request on a pre-exam attempt past its deadline (the exam window's end) marks it `EXPIRED` and records `ATTEMPT_EXPIRED`.

## End Exam

The End Exam dialog ("End Examination?") calls `POST /api/exam-attempts/:attemptId/end`.

- **On success:** the attempt is `CANCELLED`, the shell shows "This exam attempt has ended.", and the candidate goes to `VITE_LMS_URL` if it's configured.
- **On failure:** the dialog stays open and shows the server's message. It never claims success.

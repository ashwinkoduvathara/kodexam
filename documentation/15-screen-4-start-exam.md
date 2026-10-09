# 15 — Screen 4: Start Exam

**Route:** `/exam/:examId/start` · running exam: `/exam/:examId/active` (placeholder)
**Main component:** [`StartExam.tsx`](../src/components/exam/start/StartExam.tsx)
**Server logic:** `startExam` in [`exam-session-service.ts`](../src/server/services/exam-session-service.ts)

The candidate reviews the exam once more, confirms they are ready, and starts the exam.
**The exam timer starts only when the server confirms the start.** Before that the header shows the duration (e.g. "90 Minutes"), not a countdown.

## Page sections

| Section | Component | Notes |
|---|---|---|
| "You're ready to begin." + status card | [`ReadyStatusCard`](../src/components/exam/start/ReadyStatusCard.tsx) | Derived from the server session (see below) |
| Exam Overview | `ExamOverview` (reused from Screen 2, `iconTiles`) | Name, code, duration, questions, marks, passing marks, attempt *n* of *limit* |
| Before You Start | [`BeforeYouStart`](../src/components/exam/start/BeforeYouStart.tsx) | Four fixed reminders, rendered with Screen 2's `InstructionItem` |
| Exam Monitoring Requirements | `ProctoringInformation` (reused, `roomy`) | Camera / Microphone: Required or Not Required; Screen Monitoring: Enabled or Disabled; Fullscreen: Required or Not Required. Read from the attempt's policy snapshot |
| Important Notes | [`StartImportantNotes`](../src/components/exam/start/StartImportantNotes.tsx) | Blue information card |
| Acknowledgement | `CandidateAcknowledgement` (reused, new id/label/note) | Starts unchecked; keyboard-operable (Radix checkbox) |
| Back / Start Exam | `InstructionFooter` (reused) | Back goes to Screen 3 (or Screen 2 when the exam doesn't require identity) |

Screen 2 components gained optional props only; their defaults, and so Screen 2 itself, are unchanged.

## Status card

[`getStartEligibility`](../src/lib/exam/start-eligibility.ts) mirrors the server's checks for display. It is never authorisation.

| Server session | Card | Start Exam |
|---|---|---|
| `READY`, identity `VERIFIED` (or not required) | **All checks complete** (mint) | Enabled after acknowledgement |
| `READY`, identity `REVIEW_REQUIRED`, policy `ALLOW_PENDING_REVIEW` | **Ready to start · identity under review** (blue) | Enabled after acknowledgement |
| Anything else (session expired, steps missing, identity failed) | **Not ready to start** + reason | Disabled |

An attempt that isn't `READY` never sees this page: the route forwards it to the step its status requires. Under `BLOCK`, pending review keeps the attempt at `IDENTITY_VERIFICATION`, so the candidate stays on Screen 3.

## Starting the exam

1. The candidate ticks the acknowledgement and clicks **Start Exam**.
   - The button shows "Starting Exam…" and is disabled.
   - A second click is ignored.
2. `POST /api/exam-attempts/:attemptId/start-exam`. The request body is ignored: start time, duration and deadline are never taken from the browser.
3. **Server checks:**
   - authentication
   - ownership (another candidate's attempt → `404`)
   - attempt not expired, cancelled or submitted
   - status `READY`
   - system check completed and instructions acknowledged
   - identity `VERIFIED`, `NOT_REQUIRED` (only when the exam doesn't require it), or `REVIEW_REQUIRED` under `ALLOW_PENDING_REVIEW`; the policy comes from the attempt's frozen snapshot
   - exam published and inside its window
4. **In one MongoDB transaction:**
   - the conditional `READY → IN_PROGRESS` update (`examStartedAt = now`, `expiresAt = min(now + duration, exam.endAt)`)
   - the session snapshot's deadline
   - the `EXAM_STARTED` audit event

   On a standalone server without transactions, the conditional update alone still guarantees a single start.
5. The browser navigates to `/exam/:examId/active` **only after** the server's response arrives.

`startedAt` keeps its original meaning (when the attempt was opened). The exam's start time is `examStartedAt`.

## Failure handling

| Situation | Behaviour |
|---|---|
| Network failure / `5xx` | "We couldn't confirm that your exam started…", then the session is re-read. Retry is allowed |
| Server started the exam but the response was lost | The re-read session is `IN_PROGRESS` → the candidate is moved to the running exam |
| Concurrent / duplicate requests | One start, one deadline, one audit event; the others receive the running session |
| Already started (refresh, Back, typed URL) | Every preparation URL redirects to `/active`; the deadline is never reset |
| Session expired / exam closed | Error shown; the shell shows the closed-attempt state |
| Not eligible (`409`) | The server's message is shown and the page follows the server's status |

## Running exam placeholder

`/exam/:examId/active` says **"Examination Started"**: *"The timed examination session is active. The question interface will be available in the next implementation step."*
The header shows **Time Remaining**, counting down to the server's `expiresAt`. There are no questions, answers or submission yet.

## Known limitations

- **No question interface yet:** no answers, submission or auto-submit. When the time runs out, the placeholder says so, but nothing is submitted.
- **End Exam during a running exam:** the server only allows ending before the exam starts, so the dialog shows the server's refusal. Ending or submitting a running exam belongs to the question-interface phase.
- **Footer below the fold:** at 1440×900 the Start button is about 15px below the fold, and at 1280×800 about 133px. The page scrolls; text was not shrunk to fit.

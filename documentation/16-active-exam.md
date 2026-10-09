# 16 — Active Exam (Question Answering)

**Route:** `/exam/:examId/active?q=<n>`. `q` is a position in the server's paper, never a question id.
**Main component:** [`ActiveExam.tsx`](../src/components/exam/active/ActiveExam.tsx)
**Server logic:**
- [`exam-paper-service.ts`](../src/server/services/exam-paper-service.ts): paper, answers, proctoring events
- `submitExam` and the timeout in [`exam-session-service.ts`](../src/server/services/exam-session-service.ts)

The screen is only reachable while the server reports the attempt `IN_PROGRESS`. Every other status redirects to the step the status requires, or to the closed-attempt notice.

## Layout

| Region | Component | Notes |
|---|---|---|
| Header | `ExamHeader` (`variant="exam"`) | Exam name + ID, Time Remaining (server `expiresAt`), Auto Submit, End Exam, candidate menu |
| Toolbar | [`QuestionToolbar`](../src/components/exam/active/QuestionToolbar.tsx) | Section selector (from `exam.sections`), "Question n of N", Mark for Review switch |
| Question | [`QuestionCard`](../src/components/exam/active/QuestionCard.tsx) | Options A–D, Clear Selection, save status, Save & Next |
| Previous bar | inline | Previous + "x of N answered" |
| Camera | [`LiveCameraFeed`](../src/components/exam/active/LiveCameraFeed.tsx) | The real camera stream (muted, mirrored); LIVE only while frames arrive; enlarge dialog |
| Alerts | [`ProctoringAlerts`](../src/components/exam/active/ProctoringAlerts.tsx) | "Face detection unavailable" notice + the latest recorded events + View all |
| Navigator | [`QuestionNavigator`](../src/components/exam/active/QuestionNavigator.tsx) | Every question of the real paper; scrolls; View All dialog grouped by section |
| Status bar | [`ExamStatusBar`](../src/components/exam/active/ExamStatusBar.tsx) | Camera, Microphone, Speaker, Screen Monitoring, Fullscreen + Full Screen button |

## Questions and answers

- **Paper:** `GET /api/exam-attempts/:id/paper` returns the sections, the questions in server order (`questions.order`) and the persisted answer state.
  - It uses a whitelist projection: **`correctOptionIds`, topic and difficulty are never read for candidates.** Tests scan the response for them.
- **Question types:** only `SINGLE_CHOICE` is implemented. Other stored types show an honest "not supported yet" notice, and the server refuses answers to them.
- **Keyboard:** options are `role="radio"` buttons. Enter/Space selects; arrow keys do nothing, so moving focus never changes an answer.
- **Unsaved selections:** a selection is a *draft* held in memory until it is saved. The status reads "Not saved yet", then "Saving…", then "Saved at hh:mm:ss" or "Save failed". "Saved" appears only after the server responds.
- **Save & Next:**
  1. Saves first.
  2. On failure it stays on the question, keeps the selection, and offers **Retry Save**.
  3. On the last question the button is **Save Answer**.
  4. When nothing changed, it is just **Next**.
- **Clear Selection** clears the draft. If an answer was already saved, the page says *"Your saved answer (B) will be removed when you save"*, so nothing is deleted silently.
- **Leaving with an unsaved answer** (Previous, navigator, section switch) opens a dialog: **Stay / Discard Change / Save & Continue**. Closing the tab triggers the browser's leave warning.
- **Navigator states:** they come from persisted state only: Not Visited, Not Answered (visited), Answered, Marked for Review, Answered & Marked. Each also has a shape cue (✓ / bookmark) and an `aria-label`, so state never depends on colour alone.

### `POST /api/exam-attempts/:id/answers/:questionId`

```json
{ "selectedOptionId": "opt2", "expectedVersion": 3, "requestId": "…" }   // change the answer (null clears it)
{ "markedForReview": true }                                               // review flag
{ "visited": true }                                                       // first view
```

The server checks:
- authentication and ownership
- that the attempt is `IN_PROGRESS` and before its deadline
- that the question belongs to the attempt's exam (otherwise `404`)
- that the option belongs to the question (otherwise `422`)
- that the question type is supported
- a rate limit

**Concurrency:**
- Answer changes need the `answerVersion` the client last saw. A stale or racing write gets `409 ANSWER_CONFLICT` with the current state in `error.details.answer`. The page shows it and asks the candidate to save again.
- A retried request with the same `requestId` is recognised as the same write, not a conflict.
- Every write first updates the attempt (a "fence") inside the transaction, so a concurrent submission or timeout either commits first (the write gets `409 ATTEMPT_SUBMITTED`) or after it. No answer is ever accepted after submission (tested).

## Submission and timeout

| Trigger | What happens |
|---|---|
| **End Exam** (running) | Dialog "Submit and end the exam?" → `POST /api/exam-attempts/:id/submit` → `SUBMITTED` + `EXAM_SUBMITTED` audit (with the answered count), in one transaction. Idempotent |
| **Deadline passes** | The first request that notices closes the attempt. With `autoSubmitOnExpiry` it becomes `AUTO_SUBMITTED` (`submittedAt` = the deadline) + `EXAM_AUTO_SUBMITTED`; otherwise `EXPIRED`. Conditional, so it happens exactly once |
| **Timer reaches 0 in the browser** | The page locks, shows "Time is up — confirming…", and re-reads the session until the server reports the final state |

Saved answers are what's submitted. No score is calculated and no correct answer is revealed.

## Camera, microphone and fullscreen

[`useExamMonitoring`](../src/hooks/use-exam-monitoring.ts) opens only the devices the exam's policy requires, each separately.

- **Camera `live`:** only while video **frames are arriving** (`requestVideoFrameCallback`, with a fallback).
- **Microphone `live`:** while its track is running and not muted by the system.
- **Detected failures:** stopped or ended tracks (polled, because stopping a track doesn't fire `ended`), stalled video, denied permission and missing devices.
- **Recovery:** the page reconnects when a device is plugged back in, or when the candidate clicks **Reconnect**.

Nothing is recorded or uploaded. Streams are released when the page unmounts, when the route is left, and when the attempt closes.

**Fullscreen** uses the existing `useFullscreen` helper. When the exam requires it, a banner and the status-bar button enter fullscreen (a user action is required by browsers).

## Proctoring events

`POST /api/exam-attempts/:id/proctoring-events` with `{ "type": … }`. Types are whitelisted. **The server sets the label, severity and timestamp**, and writes the event and a `PROCTORING_EVENT_RECORDED` audit entry in one transaction. `GET` lists the attempt's own events, newest first.

| Event | Recorded when | Severity |
|---|---|---|
| `CAMERA_DISCONNECTED` / `CAMERA_RESTORED` | The required camera stops / is live again | HIGH / INFO |
| `MICROPHONE_DISCONNECTED` / `MICROPHONE_RESTORED` | The required microphone stops / works again | MEDIUM / INFO |
| `FULLSCREEN_EXITED` / `FULLSCREEN_RESTORED` | Required fullscreen is left / re-entered | MEDIUM / INFO |
| `TAB_HIDDEN` | The page is hidden and the policy disallows tab switching | MEDIUM |

Wording is neutral. Events are facts for review.

### Event policy

The server decides what happens using [`proctoring-policy.ts`](../src/types/proctoring-policy.ts). The policy is configured per exam in `proctoringPolicy.eventPolicy` and frozen into the attempt; `DEFAULT_EVENT_POLICY` applies otherwise.

| Action | Effect |
|---|---|
| `RECORD` | Stored and audited |
| `WARN` | A neutral instruction is returned to the page, such as *"Please return to fullscreen."* Audited as `CANDIDATE_WARNED` |
| `REVIEW` | `examAttempts.review` is flagged for a human, with the event type as the reason. Audited once per type as `ATTEMPT_FLAGGED_FOR_REVIEW`. The candidate only sees the neutral instruction, never "flagged" |
| `TERMINATE` | Ends and submits the exam (`closedReason: POLICY_TERMINATION`, audited as `EXAM_TERMINATED_BY_POLICY`). **Only for events from a TRUSTED source and only when `allowAutomaticTermination` is true.** Otherwise it becomes `REVIEW` with "termination recommended" |

**Default policy:**
- camera or microphone lost, fullscreen exited, window hidden → warn from the 1st occurrence, human review from the 3rd
- no automatic termination

**Event sources:**
- **Browser:** events reported by the candidate's browser are **untrusted**, so they can never end an exam.
- **Trusted service:** a future detection service would call `recordTrustedEvent` from server code. It has no HTTP route.

## What is *not* implemented (shown honestly)

| Feature | What the page shows |
|---|---|
| AI face / gaze detection ("head turned", "multiple faces", "looking away") | "Face detection unavailable": no AI alerts are generated |
| Screen monitoring | Status bar: **Unavailable** when the policy requires it, **Not Required** otherwise |
| Continuous speaker monitoring | **Tested** (checked during the system check) |
| Trusted detection source | None exists, so the termination path is implemented and tested but never triggered by real events |
| Server-side timeout without any request | Done by the expiry worker ([17 — Operations](17-operations.md#3-scheduling-the-expiry-worker)); it must be deployed |

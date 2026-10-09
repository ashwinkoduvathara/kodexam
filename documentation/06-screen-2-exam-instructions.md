# 06 — Screen 2: Exam Instructions

**Route:** `/exam/:examId/instructions`
**Main component:** [`ExamInstructions.tsx`](../src/components/exam/instructions/ExamInstructions.tsx)

Built from the provided reference design. It reuses the existing shell (header, timer, stepper, support card, End Exam, candidate menu, desktop gate) without changes.

## Page sections

| Section | Component | Data source |
|---|---|---|
| Title + "Secure Examination" card | `SecurityBanner` (reused, new optional props) | Static copy |
| Important notice (amber) | [`ImportantNotice`](../src/components/exam/instructions/ImportantNotice.tsx) | "You cannot pause…" only if `securityPolicy.allowPause` is false |
| Exam Overview (7 stats) | [`ExamOverview`](../src/components/exam/instructions/ExamOverview.tsx) | Exam, Exam ID, Duration, Questions, Total Marks, Passing Marks, Attempt *n of limit*, all from MongoDB |
| Before You Begin (6 cards) | [`InstructionItem`](../src/components/exam/instructions/InstructionItem.tsx) | `exam.instructions` (falls back to KProctor defaults if empty) |
| Secure Examination Environment | [`ProctoringInformation`](../src/components/exam/instructions/ProctoringInformation.tsx) | `proctoringPolicy` → Required / Not Required / Enabled / Disabled |
| Activities That May Be Flagged | [`ProhibitedActivities`](../src/components/exam/instructions/ProhibitedActivities.tsx) | Filtered by policy (e.g. "Leaving fullscreen" only if fullscreen is required) |
| Acknowledgement checkbox | [`CandidateAcknowledgement`](../src/components/exam/instructions/CandidateAcknowledgement.tsx) | Local state; persisted only on Continue |
| Back / Continue | [`InstructionFooter`](../src/components/exam/instructions/InstructionFooter.tsx) | — |

None of the sample values (Computer Network, CN-2041, 90 minutes, 50, 100, 40) are hard-coded in the UI. They exist only in the development seed.

Instruction icons come from a whitelist (`monitor`, `camera`, `user`, `book`, `smartphone`, `shield`, `clock`, `info`) mapped to lucide icons.

The flagged-activities wording informs; it never accuses:
*"KProctor may record security events during your attempt. Flagged events are reviewed according to the examination policy."*

## Acknowledgement flow

1. The checkbox starts **unchecked** and **Continue is disabled**.
2. Checking it (mouse, label click, or Space) enables **I Understand, Continue →**.
3. Continue calls `ExamSessionService.acknowledgeInstructions(attemptId)`, which sends `POST /api/exam-attempts/:attemptId/instructions/acknowledge`.
4. The server validates ownership, expiry and status (`INSTRUCTIONS`). It then stores `instructionsAcknowledgedAt`, sets the status to `IDENTITY_VERIFICATION` and writes an audit event.
5. The returned session replaces the local one, and the app navigates to `/exam/:examId/identity-verification`.

The server's response is authoritative; nothing is stored in localStorage.

## States handled

| Situation | Behaviour |
|---|---|
| Status `SYSTEM_CHECK` | Page visible; acknowledgement locked with "Complete the system check before continuing." |
| Status `INSTRUCTIONS` | Normal |
| Status `IDENTITY_VERIFICATION` / `READY` | Redirects forward to Identity Verification |
| Client timer reaches zero | "Exam session has expired." Continue disabled |
| Server says expired on Continue | Same expired message; nothing is stored |
| Attempt `EXPIRED` / `SUBMITTED` / `CANCELLED` | Shell shows the closed-attempt notice instead of the page |
| Network or other error | Inline alert with the server's safe message |

## Back

**← Back to System Check** navigates to Screen 1. Re-submitting the system check from there is allowed and doesn't move the status backwards.

## Screen 3 placeholder

[`identity-verification.tsx`](../src/routes/exam/$examId/identity-verification.tsx) shows only "Identity Verification — Coming next." It redirects back if the server status hasn't reached that step yet, so steps can't be skipped.

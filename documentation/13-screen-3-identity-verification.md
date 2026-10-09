# 13 — Screen 3: Identity Verification

**Route:** `/exam/:examId/identity-verification`
**Main component:** [`IdentityVerification.tsx`](../src/components/exam/identity/IdentityVerification.tsx)
**Server logic:** [`identity-verification-service.ts`](../src/server/services/identity-verification-service.ts)

The candidate captures one verification photo, uploads a government ID and confirms both are genuine.
The **server** then decides the result. The browser never sends or sets a verification status or result.

> Security is the priority on this screen. The full security design, assumptions and production checklist are in [14 — Identity Data Security](14-identity-data-security.md).

## Page sections

| Section | Component | Notes |
|---|---|---|
| Title + "Secure Examination" card | `SecurityBanner` (reused) | |
| "Why is identity verification required?" | `IdentityInfoBanner` | |
| Live Camera Verification | [`LiveCameraVerification`](../src/components/exam/identity/LiveCameraVerification.tsx) | Reuses Screen 1's `useCameraCheck` hook (frame verification, cleanup) |
| Government ID Verification | [`GovernmentIdUpload`](../src/components/exam/identity/GovernmentIdUpload.tsx) | ID type selection, click or drag-and-drop upload, upload status, delete |
| Verification Guidelines / Important Notes / Your Privacy | [`IdentitySidePanels`](../src/components/exam/identity/IdentitySidePanels.tsx) | The privacy "Learn more" dialog shows the server-configured retention periods |
| Consent checkbox | inline | "I confirm that this photo and ID document belong to me…" |
| Result panel | [`VerificationStatusPanel`](../src/components/exam/identity/VerificationStatusPanel.tsx) | Processing / manual review / verified / failed / expired |
| Back / Verify & Continue | inline | Back opens Screen 2 in read-only mode |

## Candidate flow

1. **Start.** The page loads the status and calls `start` (`NOT_STARTED → CAMERA_PENDING`).
2. **Capture.** The live preview stays on the device. **Capture Photo** turns *one* frame into a JPEG and uploads it (`→ PHOTO_CAPTURED`). Retaking replaces it; only one photo is ever kept.
3. **Upload ID.** The candidate selects the ID type and uploads a JPG, PNG or PDF (max 5 MB, configurable). The server validates and scans it (`→ DOCUMENT_UPLOADED`).
4. **Consent.** The candidate ticks the consent checkbox.
5. **Verify & Continue** is enabled only when: the photo is captured, a document is uploaded and not rejected, the camera is still live, consent is given, and the session hasn't expired.
6. **Server decision.** The server moves `DOCUMENT_UPLOADED → PROCESSING`, runs the verification provider, then `→ VERIFIED | FAILED | REVIEW_REQUIRED`.
   - **REVIEW_REQUIRED** (the default today; see below): the page polls every 8 seconds until an examiner decides. The live camera is switched off.
   - **VERIFIED**, or **REVIEW_REQUIRED where the exam policy allows proceeding**: the button becomes **Continue to Start Exam**.
   - **FAILED**: **Try Again** starts over (`→ CAMERA_PENDING`, previous evidence deleted), up to a configurable limit.

## Why results are "manual review" today

No automated face-match or document-authenticity service is configured. Rather than fake a result, the default provider (`manualReviewProvider`) returns **REVIEW_REQUIRED**:

- face match and document validity are set to "unknown" (`null`), never `true`
- an authorised examiner reviews the evidence and approves or rejects it

An automated provider can be added later behind `IdentityVerificationProvider`. It must never auto-fail on low confidence and never accuse the candidate.

**Exam policy:** `proctoringPolicy.identityReviewPolicy` controls what happens while a review is pending.

| Value | Behaviour |
|---|---|
| `BLOCK` (default, used by the seed) | The candidate waits for the examiner's decision |
| `ALLOW_PENDING_REVIEW` | The candidate may start; the review completes later |

## UI states covered

| State | What the candidate sees |
|---|---|
| Camera unavailable / permission denied | Message from the camera hook + Try Again |
| Poor lighting | Amber hint "Poor lighting — face a light source"; Capture disabled |
| Face not detected / face outside frame | Amber hints. Only where the browser has a real face detector; otherwise the items honestly say "Confirmed by the reviewer" |
| Document missing | Upload area with "Capture your photo first, then upload your ID" |
| Unsupported document / too large / rejected | Server message, e.g. "This file type isn't supported…" |
| Upload in progress / scanning | "Uploading and checking…" |
| Upload scanning result | "security scan passed", or "security scan pending (checked during review)" when no scanner is configured |
| Verification processing | "Verifying your identity…" |
| Manual review required | Amber panel; page updates automatically |
| Verification failed | Red panel + Try Again (if retries remain) or contact support |
| Verification successful | Green panel — only when the server returns `VERIFIED` |
| Session expired | "Exam session has expired." — no verification controls |
| Insecure connection | "Secure connection required" — nothing starts |

## Navigation

- **Back to Exam Instructions** opens `/exam/:examId/instructions?revisit=true`: a read-only view with "Return to Identity Verification".
- On success the attempt becomes `READY` and the candidate goes to Screen 4, `/exam/:examId/start` (see [15 — Screen 4](15-screen-4-start-exam.md)). From there, Back reopens this screen read-only, with the camera off.
- Arriving at Screen 3 too early redirects back. Arriving after completion redirects forward.

## Reviewer (examiner) workflow

There is no examiner UI yet (the admin portal is out of scope). Reviewers use the API, or the development script:

```bash
npm run identity:review                       # list verifications awaiting review
npm run identity:review -- approve <attemptId>
npm run identity:review -- reject <attemptId>
```

The script calls the same reviewer service as the API, so authorisation, version locking and audit events all apply. The seed creates a development examiner (`examiner.dev@kodeversity.local`) assigned to CN-2041.

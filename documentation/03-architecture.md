# 03 — Architecture

## Technology stack

KProctor uses the same stack and pinned versions as the Kodeversity LMS (`../kodeversity`).

| Layer | Technology |
|---|---|
| Framework | React 19, TanStack Start 1.168 (Vite 8) |
| Routing | TanStack Router (file-based, `src/routes`) |
| Styling | Tailwind CSS v4 (CSS-first tokens in `src/styles.css`) |
| Components | shadcn/ui (new-york) on Radix UI, lucide-react icons |
| Font | Plus Jakarta Sans |
| Database | MongoDB 8 via the official `mongodb` driver 7.5 |
| Tests | Vitest (unit/integration), puppeteer-core + Chrome (browser) |

## Data flow

Components never call the API or the database directly:

```
Browser
  ↓
TanStack Route (loader / page component)
  ↓
ExamSessionService            src/lib/exam/session/exam-session-service.ts (interface)
  ↓                           src/lib/exam/session/http-exam-session-service.ts (fetch)
REST API route                src/routes/api/**            (thin wrapper)
  ↓
API handler                   src/server/api/exam-api.ts   (auth, CSRF, error mapping)
  ↓
Server service                src/server/services/exam-session-service.ts (business rules)
  ↓
Repositories                  src/server/repositories/*.ts
  ↓
MongoDB                       src/server/db/mongodb.ts
```

## Folder structure

```
src/
├── components/
│   ├── exam/                     Exam shell (shared by every step)
│   │   ├── ExamLayout.tsx        Header + sidebar + content
│   │   ├── ExamHeader.tsx        Logo, breadcrumb, timer, auto-submit, End Exam, candidate
│   │   ├── ExamTimer.tsx         Countdown display (normal/amber/red/expired)
│   │   ├── ExamStepper.tsx       4-step progress sidebar
│   │   ├── SupportCard.tsx       "Need help?" card
│   │   ├── SupportDialog.tsx     Technical support dialog
│   │   ├── EndExamButton.tsx     Confirmation dialog → endExamAttempt()
│   │   ├── CandidateMenu.tsx     Avatar dropdown
│   │   ├── DesktopOnlyGate.tsx   "Please use a desktop or laptop" below 1024px
│   │   ├── ExamSessionStates.tsx Loading / error / closed-attempt screens
│   │   ├── exam-flow-context.tsx Session shared with step screens
│   │   ├── system-check/         Screen 1 components
│   │   └── instructions/         Screen 2 components
│   ├── layout/Logo.tsx           Kodeversity logo (same assets as the LMS)
│   └── ui/                       shadcn components copied from the LMS
├── hooks/                        Device checks, readiness store, clock, permissions
├── lib/exam/                     Client domain logic (policy, steps, media, network…)
├── routes/
│   ├── index.tsx                 Landing ("open your exam from the dashboard")
│   ├── exam/$examId.tsx          Exam shell route: loads the session
│   ├── exam/$examId/index.tsx    Redirects to the step for the current status
│   ├── exam/$examId/system-check.tsx
│   ├── exam/$examId/instructions.tsx
│   ├── exam/$examId/identity-verification.tsx   (placeholder)
│   └── api/                      REST endpoints
├── server/                       Server-only code (see below)
└── types/                        exam.ts, exam-attempt.ts, api.ts (shared)
```

### `src/server/` (server-only)

```
server/
├── env.ts                  Reads/validates server configuration
├── errors.ts               DomainError + common errors
├── request-ip.ts           Client IP for audit logs
├── db/
│   ├── mongodb.ts          Shared MongoClient (cached on globalThis)
│   ├── collections.ts      Collection names + document types
│   └── indexes.ts          ensureIndexes()
├── repositories/           One per collection: user, exam, exam-attempt, exam-session, audit-log
├── services/
│   └── exam-session-service.ts   Attempt lifecycle and business rules
├── auth/
│   ├── candidate-auth.ts   Token sign/verify, authenticateCandidate()
│   └── launch.ts           /api/auth/launch handler
├── http/api.ts             json(), error mapping, same-origin check, body parsing
├── api/exam-api.ts         REST handlers (plain Request → Response)
└── test/                   Test DB setup and fixtures
```

Every server module starts with `import "@tanstack/react-start/server-only"`.
TanStack Start's import protection then makes the client build **fail** if browser code ever imports one.
A check of the production client bundle confirmed it contains no MongoDB driver, connection string, secret or HMAC code.

## Key decisions

| Decision | Why |
|---|---|
| Standalone app, LMS stack | `Kodeexam` was empty. Matching versions and tokens means it can merge into the LMS later. |
| Styles scoped under `.kp` | Same pattern as the LMS's `.pg` Playground scope. KProctor colours never leak into the LMS. |
| Exam routes use `ssr: false` | Session data is fetched in the browser with the candidate's HttpOnly cookie. Exam pages need no SEO, and device APIs are browser-only. |
| Official MongoDB driver (not Mongoose) | KProctor had no existing Mongoose layer. The driver gives typed collections, atomic conditional updates and explicit indexes. |
| Thin route files + plain handlers | Handlers take a `Request` and return a `Response`, so they're tested directly against MongoDB without the router. |
| Server is authoritative | Deadline, status, required checks and policy all come from the server. The client never derives them. |
| Policy snapshot per attempt | `examSessions` freezes the policy when an attempt starts, so editing an exam can't change a running attempt. |

# KProctor — Kodeversity Exam Portal

KProctor is the secure examination and AI-proctoring web app for the Kodeversity LMS.
It shares the LMS's stack and design system: React 19, TanStack Start, Tailwind v4 and shadcn/ui.

## Quick start

```bash
npm install
cp .env.example .env.local        # fill in MONGODB_URI and KPROCTOR_AUTH_SECRET
npm run db:replset               # (separate terminal) local replica set — transactions need it
npm run db:seed -- --reset        # seeds the dev exam and prints a launch link
npm run dev                       # http://localhost:3100
```

Open the launch link that the seed prints. It signs you in as the development candidate and opens the exam.

## Documentation

Full documentation is in [`documentation/`](documentation/README.md).

| Status | Screen |
|---|---|
| ✅ Done | 1 — System Check |
| ✅ Done | 2 — Exam Instructions |
| ✅ Done (pending approval) | 3 — Identity Verification |
| ⏳ Placeholder only | 4 — Start Exam |

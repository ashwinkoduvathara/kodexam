# 02 — Getting Started

## Requirements

| Tool | Version used |
|---|---|
| Node.js | 24.x (needs `process.loadEnvFile`) |
| npm | 11.x |
| MongoDB | 8.x **replica set** (transactions). Locally: `npm run db:replset` runs one on port 27018 from the installed `mongod` |
| Google Chrome | Any current version (only for browser tests) |

## 1. Install

```bash
npm install
```

## 2. Configure environment

Copy the template and fill in the values:

```bash
cp .env.example .env.local
```

| Variable | Side | Required | Description |
|---|---|---|---|
| `MONGODB_URI` | Server | ✅ | MongoDB connection string |
| `MONGODB_DB_NAME` | Server | — | Database name (default `kodeproctor`) |
| `KPROCTOR_AUTH_SECRET` | Server | ✅ | At least 32 random characters. Signs candidate launch tokens |
| `KPROCTOR_APP_URL` | Server | — | Public URL, used by scripts to print launch links (default `http://localhost:3100`) |
| `KPROCTOR_TRUST_PROXY` | Server | — | `true` only when behind a trusted proxy (enables `X-Forwarded-For` for audit IPs) |
| `VITE_SUPPORT_EMAIL` | Client | — | Support email (default `info@kodeversity.com`) |
| `VITE_SUPPORT_PHONE` | Client | — | Support phone (default `+91 8086 9090 55`) |
| `VITE_SUPPORT_HOURS` | Client | — | Support hours (**default is a placeholder; confirm it**) |
| `VITE_LMS_URL` | Client | — | Where candidates go after leaving an exam |
| `VITE_NETWORK_TEST_BASE_URL` | Client | — | Optional external network-test service (default `/api/network-test`) |

> **Security:** server variables are read only through `process.env` on the server and never reach the browser. `VITE_*` variables **are** bundled into the browser build, so never put secrets in them.
> `.env` and `.env.*` are git-ignored; only `.env.example` is committed.

To generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## 3. Start a local replica set (development)

Identity verification commits status changes and audit events in **transactions**, which need a replica set. In a separate terminal, run:

```bash
npm run db:replset
```

Then set `MONGODB_URI=mongodb://127.0.0.1:27018/?replicaSet=rs0&directConnection=true`. Data is kept in `./.data/mongodb-rs` (git-ignored). Your existing MongoDB service isn't touched.

## Identity verification settings

See `.env.example` for the full list and [14 — Identity Data Security](14-identity-data-security.md) for what each one protects. For local development:

```bash
KPROCTOR_IDENTITY_STORAGE=local
KPROCTOR_IDENTITY_MASTER_KEY=<32 random bytes, base64>   # node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
KPROCTOR_MALWARE_SCANNER=none                            # documents stay SCAN_PENDING
```

Production requires `s3` storage with a KMS key, a ClamAV scanner and HTTPS. It refuses identity operations otherwise.

## 4. Seed the development database

```bash
npm run db:seed              # create/update the dev candidate + exam, ensure indexes
npm run db:seed -- --reset   # also delete the dev candidate's attempts (start fresh)
```

The seed creates:

- **Candidate:** Jaydeep Das, roll no. `123456789`
- **Exam:** `CN-2041` Computer Network — 90 min, 50 questions, 100 marks, pass 40, 1 attempt, all proctoring required

It then prints a **launch link** that is valid for 8 hours:

```
http://localhost:3100/api/auth/launch?token=…&next=%2Fexam%2F<examId>
```

Opening that link signs you in as the candidate and opens the exam.
The seed refuses to run with `NODE_ENV=production`.

To create or update indexes on their own (safe to run on every deploy):

```bash
npm run db:indexes
```

## 5. Run

```bash
npm run dev       # development server on http://localhost:3100
npm run build     # production build
npm run preview   # serve the production build
```

## 6. Quality checks

```bash
npm run typecheck   # TypeScript
npm run lint        # ESLint + Prettier rules
npm test            # unit + MongoDB integration tests (uses kodeproctor_test)
npm run test:e2e    # browser tests; the app must be running (see 11-testing.md)
```

## npm scripts

| Script | Command |
|---|---|
| `dev` | `vite dev` |
| `build` | `vite build` |
| `preview` | `vite preview` |
| `typecheck` | `tsc --noEmit` |
| `lint` | `eslint .` |
| `format` | `prettier --write .` |
| `test` | `vitest run` |
| `test:e2e` | `tsx e2e/run.ts` |
| `db:indexes` | `tsx scripts/db-indexes.ts` |
| `db:seed` | `tsx scripts/seed.ts` |
| `db:replset` | `tsx scripts/dev-replset.ts` — local single-node replica set |
| `identity:review` | `tsx scripts/identity-review.ts` — list / approve / reject pending identity reviews (development) |
| `identity:purge` | `tsx scripts/identity-purge.ts` — retention job; schedule it |

# 17 — Operations: Deployment, Scheduling, Monitoring, Recovery

This covers what has to run, how to configure it, how to tell when something is wrong, and what to do about it.
**Passing tests does not make a deployment production-ready.** Work through the [production checklist](#8-production-checklist) and the open items in [12](12-open-items.md).

## 1. What runs

| Component | Command | Instances | Notes |
|---|---|---|---|
| Web app (SSR + API) | `npm run build`, then the built server | 1+ behind HTTPS | Stateless; sessions are signed cookies |
| **Expiry worker** | `npm run worker:expiry` | **1+ (any number is safe)** | Closes exams past their deadline. Required: without it, abandoned exams are only closed when someone reopens them |
| MongoDB | replica set (e.g. Atlas) | 3-node replica set | Transactions are required |
| Object storage | S3-compatible bucket, SSE-KMS | n/a | Identity documents and photos |
| ClamAV (`clamd`) | network daemon | 1+ | Required in production |
| Identity purge | `npm run identity:purge` (scheduled, e.g. hourly) | 1 | Retention enforcement |

## 2. Environment variables

All are server-only unless prefixed `VITE_`. Keep secrets in a secret manager, never in Git, images or client bundles. `.env.example` lists every variable.

| Variable | Required | Purpose |
|---|---|---|
| `MONGODB_URI`, `MONGODB_DB_NAME` | yes | Replica-set connection |
| `KPROCTOR_AUTH_SECRET` | yes (≥ 32 chars) | Signs KProctor **session** cookies |
| `KPROCTOR_LMS_LAUNCH_PUBLIC_KEY` | yes in production | Ed25519 public key (SPKI base64 or PEM) that verifies LMS launch tokens |
| `KPROCTOR_LMS_ISSUER` | with the key | Expected `iss` of launch tokens (the LMS URL) |
| `KPROCTOR_LAUNCH_MAX_LIFETIME_SECONDS` | no (120) | Longest accepted launch-token lifetime |
| `KPROCTOR_LAUNCH_CLOCK_SKEW_SECONDS` | no (30) | Allowed clock difference with the LMS |
| `KPROCTOR_SESSION_TTL_MINUTES` | no (480) | Session cookie lifetime after a launch |
| `KPROCTOR_ALLOW_DEV_LAUNCH` | **never in production** | Lets a production build accept dev launch links (local preview only) |
| `KPROCTOR_EXPIRY_INTERVAL_SECONDS` | no (15) | Worker sweep interval |
| `KPROCTOR_EXPIRY_BATCH_SIZE` | no (200) | Attempts closed per sweep (the next sweep continues) |
| `KPROCTOR_EXPIRY_LEASE_SECONDS` | no (60) | How long a claimed attempt is reserved for one worker |
| `KPROCTOR_EXPIRY_ALERT_SECONDS` | no (120) | Running exams overdue longer than this → health "degraded" |
| `KPROCTOR_OPS_TOKEN` | recommended (≥ 32 chars) | Enables `GET /api/ops/health` (Bearer token) |
| `KPROCTOR_TRUST_PROXY` | behind a proxy | Trust `X-Forwarded-For/Proto` |
| `KPROCTOR_BACKUP_KEY` | for encrypted backups | 32-byte base64 key used by `npm run drill:backup` |
| Identity storage / scanner / retention variables | see [14](14-identity-data-security.md) | Production refuses local storage, no scanner, or no KMS key |

## 3. Scheduling the expiry worker

The worker ([`expiry-worker.ts`](../src/server/jobs/expiry-worker.ts)) finds attempts whose server `expiresAt` has passed (index `status_expiresAt`) and closes them:
- **running exams:** `AUTO_SUBMITTED`, or `EXPIRED` when the exam's `autoSubmitOnExpiry` is off
- **setups whose exam window closed:** `EXPIRED`

Each close records its audit event (`closedBy: "EXPIRY_WORKER"`, `delaySeconds`).

**Exactly once with any number of instances:**
1. A worker **atomically claims** one attempt at a time by setting a lease (`expiryLease`).
2. Closing is a **conditional update in a transaction** with its audit event, so a duplicate attempt to close changes nothing.
3. A crashed worker's lease expires (`KPROCTOR_EXPIRY_LEASE_SECONDS`) and another worker retries.

Answers are refused from the deadline onwards by the answer API itself, even if no worker has run yet and the browser is still open.

Run it either as:
- **Long-running service** (recommended): `npm run worker:expiry`. It handles SIGTERM by finishing the current sweep, then exiting.
- **Cron / Kubernetes CronJob**: `npm run worker:expiry -- --once` every minute. Exit code 1 means some attempts failed and will be retried next run.

Worker clocks must be NTP-synchronised; deadlines are compared with the server's clock.

## 4. Monitoring

| Signal | Where | Alert when |
|---|---|---|
| Job health | `GET /api/ops/health` with `Authorization: Bearer $KPROCTOR_OPS_TOKEN` (200 ok / 503 degraded), or `npm run ops:status` (exit 0/1) | **degraded** for more than 2 checks |
| Worker never succeeded / stale | health `problems` | No success for more than 4 × interval (minimum 60 s) |
| Consecutive failed runs | `expiryWorker.consecutiveFailures`, `lastError.name/code` | > 0 for 2+ runs |
| Delayed auto-submission | `overdueAttempts.count / oldestSeconds` | Oldest > `KPROCTOR_EXPIRY_ALERT_SECONDS` |
| Worker logs | `[kproctor] expiry sweep finished {claimed, closed, failed, overdue, durationMs}` | `failed > 0` |
| Launch rejections | `[kproctor] launch rejected {reason}` + audit `LAUNCH_REJECTED` | Spikes of `BAD_SIGNATURE` / `REPLAYED` (attack or LMS key problem); any `DISABLED` (misconfiguration) |
| Identity outages | `503` on identity endpoints; audit `DOCUMENT_SCAN_COMPLETED {result: SCAN_FAILED}` | Any sustained rate |
| Review flags | audit `ATTEMPT_FLAGGED_FOR_REVIEW` | Route to examiners (not an incident) |

Logs contain identifiers, counters and error names/codes only; never tokens, documents, images or answers.

## 5. Backups and recovery

**What must be backed up:**
- MongoDB (all collections)
- The identity bucket (versioning plus lifecycle rules matching retention)
- The KMS key policy
- Secrets: the auth secret and LMS public key; the LMS private key belongs to the LMS

**Encryption and access:**
- Backups are encrypted at rest (Atlas Cloud Backup encryption, or `mongodump` archives encrypted with `KPROCTOR_BACKUP_KEY` / a KMS key).
- They are stored separately from production credentials, readable only by the backup role, and their restores are logged.
- Backups contain personal data, so retention applies to them as well.

**Methods:**
- **Atlas Cloud Backup / snapshots** (recommended): point-in-time restore.
- **`mongodump --archive --gzip`**, then encrypt and store off-site, restored with `mongorestore`. These tools are **not installed in the development environment**, so this method has not been drilled here.
- **Filesystem snapshot** (cold copy of the data directory after a clean shutdown): automated and drilled by `npm run drill:backup`.

**Restore drill** (`npm run drill:backup`) runs entirely in throwaway instances and never touches existing databases:
1. Seeds an isolated replica set.
2. Fingerprints each collection: counts, the SHA-256 of all documents and the index names.
3. Shuts it down cleanly and encrypts every data file (AES-256-GCM).
4. Checks that a marker string visible in the raw data is absent from the backup, and that a wrong key fails.
5. Decrypts into a new directory, starts a **separate isolated instance**, and requires identical fingerprints.

Run it after any MongoDB upgrade and at least quarterly.

**Restoring production (runbook):**
1. Freeze writes: put the app in maintenance mode and stop the workers.
2. Restore into a **new** cluster (never over the damaged one) at the chosen point in time.
3. Run `npm run db:indexes` against it.
4. Verify counts and spot-check attempts in progress, `candidateAnswers` and `auditLogs`.
5. Switch `MONGODB_URI`, start the app, then the workers. The worker immediately closes anything past its deadline.
6. Record the incident and data-loss window. Attempts whose answers fall in the lost window may need examiner decisions.

## 6. Incident response

| Incident | Detect | Respond |
|---|---|---|
| **Worker down / exams not auto-submitting** | health degraded (stale, overdue) | Restart/scale the worker. No data is lost: answers after the deadline are refused anyway, and the worker closes the backlog on restart. Check `lastError` |
| **MongoDB unavailable / failover** | 503s, worker failures | Replica set failover is automatic. If prolonged, exams can't save; consider extending deadlines by examiner decision (an admin action, not built yet) |
| **ClamAV outage** | Upload 503s, `SCAN_FAILED` audits | Uploads fail closed (nothing stored). Restore clamd; candidates retry. Never switch the scanner to `none` in production (the app refuses) |
| **Storage / KMS outage** | Capture/upload 503s | Fails closed. Restore the bucket/KMS access; nothing partial is recorded |
| **Suspected launch-key compromise** | Unexpected `CANDIDATE_LAUNCHED`, `BAD_SIGNATURE` spikes | Generate a new key pair (`npm run lms:keygen`), give the private key to the LMS, deploy the new public key. Old tokens stop working immediately; sessions already issued expire within `KPROCTOR_SESSION_TTL_MINUTES` (rotate `KPROCTOR_AUTH_SECRET` to end them all at once) |
| **`KPROCTOR_AUTH_SECRET` leak** | n/a | Rotate the secret. All sessions end; candidates relaunch from the LMS |
| **Replay attempts** | `LAUNCH_REJECTED {reason: REPLAYED}` | Expected occasionally (double clicks). Spikes: investigate the source IPs in the audit log |
| **Proctoring event surge** | many `PROCTORING_EVENT_RECORDED` | Browser events are untrusted signals; review flagged attempts. Nothing is terminated automatically on browser events |

## 7. LMS launch setup

1. `npm run lms:keygen` writes the private key to a `0600` file and prints `KPROCTOR_LMS_LAUNCH_PUBLIC_KEY`.
2. LMS side:
   - Store the private key in its secret manager.
   - After authenticating the user server-side, sign with [`integrations/lms/kproctor-launch.ts`](../integrations/lms/kproctor-launch.ts) and POST the token to `/api/auth/lms-launch`, using `renderLaunchForm`.
3. KProctor side: set `KPROCTOR_LMS_LAUNCH_PUBLIC_KEY` and `KPROCTOR_LMS_ISSUER`.
4. Development: `npm run lms:launch -- <private.pem> <lmsUserId> <examCode> "<Name>"` prints a one-time link.

**The LMS currently has no sign-in implementation**, so step 2 can't be completed yet (see [12](12-open-items.md)).

## 8. Production checklist

- [ ] MongoDB replica set; `npm run db:indexes` run; backups configured, encrypted and drilled
- [ ] `npm run verify:identity-infra` **passes** against the real bucket, KMS key and ClamAV (BLOCKED is not a pass)
- [ ] Expiry worker deployed (≥ 1 instance), `KPROCTOR_OPS_TOKEN` set, health check wired to alerting
- [ ] `KPROCTOR_LMS_LAUNCH_PUBLIC_KEY` / `KPROCTOR_LMS_ISSUER` set; **`KPROCTOR_ALLOW_DEV_LAUNCH` unset**
- [ ] HTTPS only; `KPROCTOR_TRUST_PROXY` set correctly; HSTS active
- [ ] `identity:purge` scheduled; retention periods confirmed by Kodeversity
- [ ] Event policy per exam reviewed (defaults: warn on first occurrence, human review from the third; no automatic termination)
- [ ] Incident contacts and the runbooks above assigned to people

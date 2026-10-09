import "@tanstack/react-start/server-only";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { Db } from "mongodb";
import { ACTIVE_ATTEMPT_STATUSES, ATTEMPT_STATUS } from "@/types/exam-attempt";
import { getCollections, type ExamAttemptDoc } from "../db/collections";
import { logError, logEvent } from "../log";
import { closeAttemptIfDue } from "../services/attempt-closure";

/**
 * Scheduled expiry: closes every open attempt whose server deadline has
 * passed, without depending on a candidate reopening the exam.
 *
 * Safe with any number of worker instances:
 * 1. A worker claims ONE overdue attempt at a time with an atomic
 *    findOneAndUpdate that sets a short lease (`expiryLease`). Two workers can
 *    never hold the same lease.
 * 2. Closing is itself conditional and transactional (attempt-closure.ts), so
 *    even a duplicate run closes and audits an attempt exactly once.
 * 3. A worker that crashes mid-way leaves its lease to expire; the attempt is
 *    then claimed again and retried. Transient database errors are retried by
 *    the transaction helper; anything else is counted, logged and retried on
 *    the next sweep.
 *
 * Deadlines are compared with this server's clock (never a browser's). Keep
 * servers NTP-synchronised.
 */

export const EXPIRY_JOB = "exam-expiry";
export const WORKER_STATUS_COLLECTION = "workerStatus";

export interface ExpiryWorkerConfig {
  intervalSeconds: number;
  batchSize: number;
  leaseSeconds: number;
  /** Overdue attempts older than this mark the job as delayed. */
  alertAfterSeconds: number;
}

export interface SweepResult {
  workerId: string;
  claimed: number;
  closed: number;
  alreadyClosed: number;
  failed: number;
  /** Open attempts still past their deadline after the sweep. */
  overdue: number;
  oldestOverdueSeconds: number;
  durationMs: number;
}

export interface WorkerStatusDoc {
  _id: string;
  lastRunAt: Date;
  lastRunBy: string;
  lastSuccessAt: Date | null;
  consecutiveFailures: number;
  lastError: { name: string; code: string | number | null; at: Date } | null;
  lastResult: Omit<SweepResult, "workerId">;
}

export function defaultWorkerId() {
  return `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
}

/** Atomically claims the most overdue open attempt that no live lease holds. */
async function claimNext(db: Db, workerId: string, now: Date, leaseSeconds: number) {
  return getCollections(db).examAttempts.findOneAndUpdate(
    {
      status: { $in: [...ACTIVE_ATTEMPT_STATUSES] },
      expiresAt: { $lte: now },
      $or: [{ expiryLease: { $exists: false } }, { "expiryLease.until": { $lte: now } }],
    },
    {
      $set: { expiryLease: { by: workerId, until: new Date(now.getTime() + leaseSeconds * 1000) } },
    },
    { sort: { expiresAt: 1 }, returnDocument: "after" },
  );
}

async function overdueStats(db: Db, now: Date) {
  const filter = { status: ATTEMPT_STATUS.IN_PROGRESS, expiresAt: { $lte: now } };
  const examAttempts = getCollections(db).examAttempts;
  const [overdue, oldest] = await Promise.all([
    examAttempts.countDocuments(filter),
    examAttempts.findOne(filter, { sort: { expiresAt: 1 }, projection: { expiresAt: 1 } }),
  ]);
  const oldestOverdueSeconds = oldest
    ? Math.max(0, Math.round((now.getTime() - oldest.expiresAt.getTime()) / 1000))
    : 0;
  return { overdue, oldestOverdueSeconds };
}

export async function runExpirySweep(
  db: Db,
  opts: {
    workerId: string;
    config: Pick<ExpiryWorkerConfig, "batchSize" | "leaseSeconds">;
    clock?: () => Date;
    /** Injected in tests to simulate failures; defaults to the real closure. */
    close?: typeof closeAttemptIfDue;
  },
): Promise<SweepResult> {
  const clock = opts.clock ?? (() => new Date());
  const close = opts.close ?? closeAttemptIfDue;
  const started = Date.now();
  const result = { claimed: 0, closed: 0, alreadyClosed: 0, failed: 0 };
  const ctx = { ipAddress: null, userAgent: `kproctor-${EXPIRY_JOB}` };

  for (let i = 0; i < opts.config.batchSize; i++) {
    const now = clock();
    let attempt: ExamAttemptDoc | null;
    try {
      attempt = await claimNext(db, opts.workerId, now, opts.config.leaseSeconds);
    } catch (error) {
      result.failed += 1;
      logError("expiry claim failed", error, { job: EXPIRY_JOB, workerId: opts.workerId });
      break;
    }
    if (!attempt) break;
    result.claimed += 1;
    try {
      const { changed } = await close(db, attempt, { now, ctx, closedBy: "EXPIRY_WORKER" });
      if (changed) {
        result.closed += 1;
        logEvent("attempt closed at deadline", {
          job: EXPIRY_JOB,
          attemptId: attempt._id.toHexString(),
          status: attempt.status,
          delaySeconds: Math.round((now.getTime() - attempt.expiresAt.getTime()) / 1000),
        });
      } else {
        result.alreadyClosed += 1;
      }
    } catch (error) {
      // The lease stays until it expires, so this attempt is retried later (by any worker).
      result.failed += 1;
      logError("expiry close failed", error, {
        job: EXPIRY_JOB,
        workerId: opts.workerId,
        attemptId: attempt._id.toHexString(),
      });
    }
  }

  const stats = await overdueStats(db, clock());
  return { workerId: opts.workerId, ...result, ...stats, durationMs: Date.now() - started };
}

/** Records the outcome of a run for monitoring (see ops/health.ts). */
export async function recordWorkerRun(
  db: Db,
  run: { result?: SweepResult; error?: unknown; workerId: string; at: Date },
) {
  const coll = db.collection<WorkerStatusDoc>(WORKER_STATUS_COLLECTION);
  const ok = !run.error && (run.result?.failed ?? 0) === 0;
  const e = run.error as { name?: string; code?: string | number } | undefined;
  const { workerId: _ignored, ...lastResult } = run.result ?? {
    workerId: run.workerId,
    claimed: 0,
    closed: 0,
    alreadyClosed: 0,
    failed: 1,
    overdue: -1,
    oldestOverdueSeconds: -1,
    durationMs: 0,
  };
  await coll.updateOne(
    { _id: EXPIRY_JOB },
    ok
      ? {
          $set: {
            lastRunAt: run.at,
            lastRunBy: run.workerId,
            lastSuccessAt: run.at,
            consecutiveFailures: 0,
            lastResult,
          },
          $setOnInsert: { lastError: null },
        }
      : {
          $set: {
            lastRunAt: run.at,
            lastRunBy: run.workerId,
            lastResult,
            lastError: {
              name: e?.name ?? "PartialFailure",
              code: e?.code ?? null,
              at: run.at,
            },
          },
          $inc: { consecutiveFailures: 1 },
          $setOnInsert: { lastSuccessAt: null },
        },
    { upsert: true },
  );
}

/** One sweep plus its status record. Never throws (the loop must keep running). */
export async function runExpiryJobOnce(
  db: Db,
  workerId: string,
  config: ExpiryWorkerConfig,
): Promise<SweepResult | null> {
  const at = new Date();
  try {
    const result = await runExpirySweep(db, { workerId, config });
    await recordWorkerRun(db, { result, workerId, at });
    logEvent("expiry sweep finished", {
      job: EXPIRY_JOB,
      workerId,
      claimed: result.claimed,
      closed: result.closed,
      alreadyClosed: result.alreadyClosed,
      failed: result.failed,
      overdue: result.overdue,
      oldestOverdueSeconds: result.oldestOverdueSeconds,
      durationMs: result.durationMs,
    });
    return result;
  } catch (error) {
    logError("expiry sweep failed", error, { job: EXPIRY_JOB, workerId });
    await recordWorkerRun(db, { error, workerId, at }).catch(() => undefined);
    return null;
  }
}

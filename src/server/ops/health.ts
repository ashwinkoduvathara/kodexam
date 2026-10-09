import "@tanstack/react-start/server-only";
import { timingSafeEqual } from "node:crypto";
import type { Db } from "mongodb";
import { ATTEMPT_STATUS } from "@/types/exam-attempt";
import { getCollections } from "../db/collections";
import { loadServerEnv } from "../env";
import {
  EXPIRY_JOB,
  WORKER_STATUS_COLLECTION,
  type ExpiryWorkerConfig,
  type WorkerStatusDoc,
} from "../jobs/expiry-worker";

export interface JobHealth {
  status: "ok" | "degraded";
  problems: string[];
  expiryWorker: {
    lastRunAt: string | null;
    lastSuccessAt: string | null;
    secondsSinceSuccess: number | null;
    consecutiveFailures: number;
    lastError: { name: string; code: string | number | null; at: string } | null;
  };
  overdueAttempts: { count: number; oldestSeconds: number };
  checkedAt: string;
}

/**
 * Monitoring view of the expiry job. "degraded" when the worker hasn't
 * succeeded recently, keeps failing, or running exams sit past their deadline
 * for longer than the alert threshold (auto-submission is delayed).
 */
export async function getJobHealth(
  db: Db,
  config: Pick<ExpiryWorkerConfig, "intervalSeconds" | "alertAfterSeconds">,
  now: Date = new Date(),
): Promise<JobHealth> {
  const status = await db
    .collection<WorkerStatusDoc>(WORKER_STATUS_COLLECTION)
    .findOne({ _id: EXPIRY_JOB });
  const filter = { status: ATTEMPT_STATUS.IN_PROGRESS, expiresAt: { $lte: now } };
  const attempts = getCollections(db).examAttempts;
  const [count, oldest] = await Promise.all([
    attempts.countDocuments(filter),
    attempts.findOne(filter, { sort: { expiresAt: 1 }, projection: { expiresAt: 1 } }),
  ]);
  const oldestSeconds = oldest
    ? Math.round((now.getTime() - oldest.expiresAt.getTime()) / 1000)
    : 0;
  const sinceSuccess = status?.lastSuccessAt
    ? Math.round((now.getTime() - status.lastSuccessAt.getTime()) / 1000)
    : null;

  const problems: string[] = [];
  const staleAfter = Math.max(config.intervalSeconds * 4, 60);
  if (sinceSuccess === null) problems.push("expiry worker has never completed a run");
  else if (sinceSuccess > staleAfter)
    problems.push(`no successful expiry run for ${sinceSuccess}s`);
  if ((status?.consecutiveFailures ?? 0) > 0) {
    problems.push(`${status!.consecutiveFailures} consecutive failed expiry run(s)`);
  }
  if (oldestSeconds > config.alertAfterSeconds) {
    problems.push(`${count} running exam(s) past their deadline, oldest ${oldestSeconds}s`);
  }

  return {
    status: problems.length ? "degraded" : "ok",
    problems,
    expiryWorker: {
      lastRunAt: status?.lastRunAt?.toISOString() ?? null,
      lastSuccessAt: status?.lastSuccessAt?.toISOString() ?? null,
      secondsSinceSuccess: sinceSuccess,
      consecutiveFailures: status?.consecutiveFailures ?? 0,
      lastError: status?.lastError
        ? { ...status.lastError, at: status.lastError.at.toISOString() }
        : null,
    },
    overdueAttempts: { count, oldestSeconds },
    checkedAt: now.toISOString(),
  };
}

/**
 * Ops endpoints are off unless KPROCTOR_OPS_TOKEN (>= 32 chars) is set; then
 * they need `Authorization: Bearer <token>`, compared in constant time.
 */
export function opsAuthorized(request: Request): boolean | "disabled" {
  loadServerEnv();
  const expected = process.env.KPROCTOR_OPS_TOKEN?.trim();
  if (!expected || expected.length < 32) return "disabled";
  const provided = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

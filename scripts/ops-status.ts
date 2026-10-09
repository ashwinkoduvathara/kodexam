/**
 * Prints expiry-job health (the same check as GET /api/ops/health).
 * Exit code 0 = ok, 1 = degraded, so cron jobs and monitoring agents can alert on it.
 *
 *   npm run ops:status
 */
import { closeMongoClient, getDb } from "@/server/db/mongodb";
import { getExpiryWorkerConfig } from "@/server/jobs/config";
import { getJobHealth } from "@/server/ops/health";

getJobHealth(await getDb(), getExpiryWorkerConfig())
  .then((health) => {
    console.log(JSON.stringify(health, null, 2));
    process.exitCode = health.status === "ok" ? 0 : 1;
  })
  .finally(() => closeMongoClient());

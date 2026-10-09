/**
 * Exam expiry worker: closes running exams (and stale setups) whose server
 * deadline has passed. Deploy it next to the app; any number of instances is safe.
 *
 *   npm run worker:expiry              # long-running loop (every KPROCTOR_EXPIRY_INTERVAL_SECONDS)
 *   npm run worker:expiry -- --once    # one sweep, then exit (cron / Kubernetes CronJob)
 *
 * Exit code with --once: 0 = sweep OK, 1 = something failed (retried on the next run).
 */
import { closeMongoClient, getDb } from "@/server/db/mongodb";
import { getExpiryWorkerConfig } from "@/server/jobs/config";
import { defaultWorkerId, runExpiryJobOnce } from "@/server/jobs/expiry-worker";

const once = process.argv.includes("--once");
const config = getExpiryWorkerConfig();
const workerId = defaultWorkerId();
let stopping = false;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true; // finish the current sweep, then exit
  });
}

async function main() {
  const db = await getDb();
  console.info(
    `[kproctor] expiry worker ${workerId} started (${once ? "single run" : `every ${config.intervalSeconds}s`})`,
  );
  do {
    const result = await runExpiryJobOnce(db, workerId, config);
    if (once) {
      process.exitCode = result && result.failed === 0 ? 0 : 1;
      break;
    }
    await new Promise((r) => setTimeout(r, config.intervalSeconds * 1000));
  } while (!stopping);
}

main()
  .catch((error) => {
    console.error("[kproctor] expiry worker crashed", { errorName: (error as Error)?.name });
    process.exitCode = 1;
  })
  .finally(() => closeMongoClient());

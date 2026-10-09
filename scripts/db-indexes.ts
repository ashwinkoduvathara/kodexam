/** Creates/updates MongoDB indexes. Safe to run repeatedly (e.g. on every deploy). */
import { ensureIndexes } from "@/server/db/indexes";
import { closeMongoClient, getDb } from "@/server/db/mongodb";
import { getIdentityConfig } from "@/server/identity/config";

ensureIndexes(await getDb(), { auditRetentionDays: getIdentityConfig().auditRetentionDays })
  .then(() => console.log("Indexes are up to date."))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeMongoClient());

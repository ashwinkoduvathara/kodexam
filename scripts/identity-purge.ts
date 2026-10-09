/**
 * Retention job: deletes identity documents and photos past their retention
 * deadline and records IDENTITY_DATA_PURGED for each. Schedule it (e.g. hourly
 * cron) in every environment that stores identity data — retention is only
 * enforced while this job runs.
 *
 *   npm run identity:purge
 */
import { closeMongoClient, getDb } from "@/server/db/mongodb";
import { createIdentityVerificationService } from "@/server/services/identity-verification-service";

createIdentityVerificationService(await getDb())
  .purgeExpired({ ipAddress: null, userAgent: "identity-purge-job" })
  .then(({ purged }) => console.log(`Purged identity data for ${purged} verification(s).`))
  .catch((e) => {
    console.error(e instanceof Error ? e.name : "Purge failed");
    process.exitCode = 1;
  })
  .finally(() => closeMongoClient());

/**
 * DEVELOPMENT reviewer tool (stands in for the future examiner portal).
 * Decisions go through the same reviewer service as the API: authorisation,
 * optimistic concurrency and audit events all apply.
 *
 *   npm run identity:review                       # list verifications awaiting review
 *   npm run identity:review -- approve <attemptId>
 *   npm run identity:review -- reject <attemptId>
 */
import { ObjectId } from "mongodb";
import { getCollections } from "@/server/db/collections";
import { closeMongoClient, getDb } from "@/server/db/mongodb";
import { createIdentityVerificationService } from "@/server/services/identity-verification-service";

const [action, attemptId] = process.argv.slice(2);

async function main() {
  const db = await getDb();
  const c = getCollections(db);
  const examiner = await c.users.findOne({ email: "examiner.dev@kodeversity.local" });
  if (!examiner) throw new Error("Run `npm run db:seed` first (creates the dev examiner).");

  if (!action) {
    const pending = await c.identityVerifications.find({ status: "REVIEW_REQUIRED" }).toArray();
    if (!pending.length) console.log("No verifications awaiting review.");
    for (const v of pending) {
      console.log(
        `${v.attemptId.toHexString()}  ${v.candidateSnapshot.name} (${v.candidateSnapshot.rollNumber})  ` +
          `doc=${v.idDocument?.documentType ?? "-"} scan=${v.idDocument?.scanStatus ?? "-"}`,
      );
    }
    return;
  }
  if ((action !== "approve" && action !== "reject") || !attemptId || !ObjectId.isValid(attemptId)) {
    throw new Error("Usage: identity:review -- approve|reject <attemptId>");
  }
  const v = await c.identityVerifications.findOne({ attemptId: new ObjectId(attemptId) });
  if (!v) throw new Error("No verification for that attempt.");
  const service = createIdentityVerificationService(db);
  const result = await service.decide(
    v._id.toHexString(),
    examiner._id,
    { decision: action === "approve" ? "APPROVE" : "REJECT", expectedVersion: v.version },
    { ipAddress: null, userAgent: "identity-review-script" },
  );
  console.log(`Verification is now ${result.status}.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => closeMongoClient());

/**
 * Browser tests for the External Candidate Exam Invite Portal. A separate
 * runner so the existing e2e runner stays untouched.
 *
 *   npx tsx e2e/invite-run.ts      (the app must be running at E2E_BASE_URL)
 */
import { mkdirSync } from "node:fs";
import { closeMongoClient, getDb } from "@/server/db/mongodb";
import { INVITES_COLLECTION } from "@/server/invites/invite-service";
import { INVITE_EMAIL_DOMAIN, runInviteSuite } from "./invite.e2e";
import { cleanupE2E, OUT, summary } from "./lib";

/** Removes invite fixtures: invites on E2E exams and the candidates they created. */
async function cleanupInvites() {
  const db = await getDb();
  const exams = await db
    .collection("exams")
    .find({ examCode: /^E2E-/ })
    .project({ _id: 1 })
    .toArray();
  await db.collection(INVITES_COLLECTION).deleteMany({ examId: { $in: exams.map((e) => e._id) } });
  const users = await db
    .collection("users")
    .find({ email: new RegExp(`@${INVITE_EMAIL_DOMAIN.replace(".", "\\.")}$`) })
    .project({ _id: 1 })
    .toArray();
  const ids = users.map((u) => u._id);
  await db.collection("auditLogs").deleteMany({ candidateId: { $in: ids } });
  await db.collection("users").deleteMany({ _id: { $in: ids } });
}

mkdirSync(OUT, { recursive: true });
let ok = false;
try {
  await cleanupInvites();
  await cleanupE2E();
  console.log("— Exam Invite Portal —");
  await runInviteSuite();
  ok = summary();
} finally {
  await cleanupInvites();
  await cleanupE2E();
  await closeMongoClient();
}
process.exit(ok ? 0 : 1);

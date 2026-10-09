/**
 * Exam invites for external candidates (people without a Kodeversity LMS account).
 * Run directly (no package.json change needed):
 *
 *   npx tsx scripts/invite-admin.ts create <examCode> <email> "<Full Name>" [--hours 72] [--max 10]
 *   npx tsx scripts/invite-admin.ts list <examCode>
 *   npx tsx scripts/invite-admin.ts revoke <inviteId>
 *
 * The invite code is printed ONCE on creation; only its keyed hash is stored.
 * Send it to the candidate through a separate channel from the portal link.
 */
import { ObjectId } from "mongodb";
import { closeMongoClient, getDb } from "@/server/db/mongodb";
import {
  createInviteService,
  ensureInviteIndexes,
  INVITES_COLLECTION,
  type ExamInviteDoc,
} from "@/server/invites/invite-service";
import { createExamRepository } from "@/server/repositories/exam-repository";

const [command, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? Number(rest[i + 1]) : undefined;
};

async function main() {
  const db = await getDb();
  await ensureInviteIndexes(db);
  const service = createInviteService(db);

  if (command === "create") {
    const [examCode, email, fullName] = rest;
    if (!examCode || !email || !fullName)
      throw new Error('Usage: create <examCode> <email> "<Full Name>"');
    const { code, invite, exam } = await service.createInvite({
      examRef: examCode,
      email,
      fullName,
      expiresInHours: flag("hours"),
      maxRedemptions: flag("max"),
      createdBy: `cli:${process.env.USERNAME ?? process.env.USER ?? "unknown"}`,
    });
    const appUrl = process.env.KPROCTOR_APP_URL ?? "http://localhost:3100";
    console.log(
      `Invite created for ${invite.fullName} <${invite.email}> — ${exam.examCode} ${exam.name}`,
    );
    console.log(`  Invite id:   ${invite._id.toHexString()}`);
    console.log(
      `  Expires:     ${invite.expiresAt.toISOString()}  (max ${invite.maxRedemptions} sign-ins)`,
    );
    console.log(`  Portal:      ${appUrl}/invite`);
    console.log(`  Invite code: ${code}   ← shown only now; it is stored hashed`);
    return;
  }

  if (command === "list") {
    const exam = await createExamRepository(db).findByRef(rest[0] ?? "");
    if (!exam) throw new Error("Exam not found.");
    const list = await db
      .collection<ExamInviteDoc>(INVITES_COLLECTION)
      .find({ examId: exam._id })
      .sort({ createdAt: -1 })
      .toArray();
    if (!list.length) console.log("No invites for this exam.");
    for (const i of list) {
      console.log(
        `${i._id.toHexString()}  ${i.status.padEnd(7)}  ${i.email}  "${i.fullName}"  used ${i.redemptions}/${i.maxRedemptions}  expires ${i.expiresAt.toISOString()}`,
      );
    }
    return;
  }

  if (command === "revoke") {
    if (!rest[0] || !ObjectId.isValid(rest[0])) throw new Error("Usage: revoke <inviteId>");
    console.log(
      (await service.revokeInvite(new ObjectId(rest[0]))) ? "Revoked." : "Invite not found.",
    );
    return;
  }

  throw new Error("Commands: create | list | revoke");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeMongoClient());

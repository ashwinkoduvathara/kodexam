/**
 * Creates exam invites for a list of candidates and writes their codes to a
 * private CSV (the codes are stored hashed in the database and shown only now).
 *
 *   npx tsx scripts/invite-bulk.ts <examCode> <candidates.csv> [--hours 48] [--max 10] [--url https://…]
 *
 * candidates.csv: one candidate per line, "Full Name,email" (a header line is optional).
 * Output: .data/invites/<examCode>-<timestamp>.csv  (name, email, code, portal) + a ready-to-send message.
 * Candidates who already have an active invite for this exam are skipped (re-running is safe).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { closeMongoClient, getDb } from "@/server/db/mongodb";
import {
  createInviteService,
  ensureInviteIndexes,
  INVITES_COLLECTION,
  type ExamInviteDoc,
} from "@/server/invites/invite-service";
import { createExamRepository } from "@/server/repositories/exam-repository";
import { normalizeEmail } from "@/types/invite";

const [examCode, file, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
if (!examCode || !file) {
  console.error(
    "Usage: npx tsx scripts/invite-bulk.ts <examCode> <candidates.csv> [--hours 48] [--max 10] [--url https://…]",
  );
  process.exit(1);
}

const rows = readFileSync(file, "utf8")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => {
    const i = l.lastIndexOf(",");
    return { name: l.slice(0, i).trim().replace(/^"|"$/g, ""), email: l.slice(i + 1).trim() };
  })
  .filter((r) => r.email.includes("@"));

const db = await getDb();
try {
  await ensureInviteIndexes(db);
  const exam = await createExamRepository(db).findByRef(examCode);
  if (!exam) throw new Error(`Exam ${examCode} not found.`);
  const service = createInviteService(db);
  const portal = `${(flag("url") ?? process.env.KPROCTOR_APP_URL ?? "http://localhost:3100").replace(/\/$/, "")}/invite`;
  const out: string[] = ["name,email,code,portal"];
  let created = 0;
  let skipped = 0;
  for (const r of rows) {
    const existing = await db.collection<ExamInviteDoc>(INVITES_COLLECTION).findOne({
      examId: exam._id,
      email: normalizeEmail(r.email),
      status: "ACTIVE",
      expiresAt: { $gt: new Date() },
    });
    if (existing) {
      console.log(`skip  ${r.email} (already has an active invite; revoke it to issue a new code)`);
      skipped += 1;
      continue;
    }
    const { code } = await service.createInvite({
      examRef: exam.examCode,
      email: r.email,
      fullName: r.name,
      expiresInHours: flag("hours") ? Number(flag("hours")) : 48,
      maxRedemptions: flag("max") ? Number(flag("max")) : 10,
      createdBy: "bulk-cli",
    });
    out.push(`"${r.name.replace(/"/g, '""')}",${normalizeEmail(r.email)},${code},${portal}`);
    created += 1;
    console.log(`ok    ${r.name} <${r.email}>`);
  }
  const dir = join(process.cwd(), ".data", "invites");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${exam.examCode}-${Date.now()}.csv`);
  writeFileSync(path, out.join("\n") + "\n", { mode: 0o600 });
  console.log(`\nCreated ${created}, skipped ${skipped}. Codes (keep private): ${path}`);
  console.log(
    `\nMessage template:\n---\nDear {name},\n\nYou are invited to the "${exam.name}" (${exam.examCode}).\nOpen ${portal} on a laptop/desktop with Google Chrome, a webcam and a microphone.\nEnter your full name exactly as "{name}", your email {email} and your invite code {code}.\nThe exam is ${exam.durationMinutes} minutes; you can start between ${exam.startAt.toISOString()} and ${exam.endAt.toISOString()} (UTC).\nDo not share your code.\n---`,
  );
} finally {
  await closeMongoClient();
}

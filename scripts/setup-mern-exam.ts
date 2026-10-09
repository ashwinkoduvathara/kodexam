/**
 * Creates (or updates) the MERN Stack Developer Assessment: 60 minutes,
 * 30 single-choice questions (2 marks each, passing 24), camera + microphone +
 * fullscreen, no identity verification, auto-submit on.
 *
 *   npx tsx scripts/setup-mern-exam.ts --start 2026-10-10T10:00:00+05:30 --end 2026-10-10T13:00:00+05:30
 *   npx tsx scripts/setup-mern-exam.ts --code MERN-101-DRY --start now --end +2d     # rehearsal copy
 *
 * --start/--end define the window in which candidates may START (each gets the
 * full 60 minutes from their own start, but never beyond --end).
 * Upserts by exam code and question order, so it is safe to re-run.
 * Also writes an answer-key review sheet to demo/<code>-review.md (git-ignored).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ObjectId } from "mongodb";
import { getCollections, USER_ROLE } from "@/server/db/collections";
import { closeMongoClient, getDb } from "@/server/db/mongodb";
import { DEFAULT_EXAM_INSTRUCTIONS, EXAM_STATUS } from "@/types/exam";
import { MERN_101 } from "./exam-data/mern-101";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
function parseTime(v: string | undefined, label: string): Date {
  if (!v) throw new Error(`--${label} is required (ISO time with offset, "now", or "+2d" / "+3h")`);
  if (v === "now") return new Date();
  const rel = v.match(/^\+(\d+)([hd])$/);
  if (rel) return new Date(Date.now() + Number(rel[1]) * (rel[2] === "d" ? 86_400_000 : 3_600_000));
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error(`--${label}: invalid time "${v}"`);
  return d;
}

const code = arg("code") ?? "MERN-101";
const startAt = parseTime(arg("start"), "start");
const endAt = parseTime(arg("end"), "end");
if (endAt <= startAt) throw new Error("--end must be after --start");

const db = await getDb();
const c = getCollections(db);
const now = new Date();
/**
 * Balance answer positions: question i's correct option is moved to position
 * i % 4 (A, B, C, D, A, …) by swapping, so "always pick B" can't score well.
 */
let position = 0;
const sections = MERN_101.sections.map((s) => ({
  ...s,
  questions: s.questions.map(([prompt, options, correct, topic, difficulty]) => {
    const target = (position++ % 4) as 0 | 1 | 2 | 3;
    const opts = [...options] as typeof options;
    [opts[correct], opts[target]] = [opts[target], opts[correct]];
    return [prompt, opts, target, topic, difficulty] as const;
  }),
}));
const entries = sections.flatMap((s) => s.questions.map((q) => ({ sectionId: s.id, q })));

try {
  const exam = await c.exams.findOneAndUpdate(
    { examCode: code },
    {
      $setOnInsert: { _id: new ObjectId(), createdBy: null, createdAt: now },
      $set: {
        name: code.endsWith("-DRY")
          ? "MERN Stack Assessment (Rehearsal)"
          : "MERN Stack Developer Assessment",
        description:
          "MongoDB, Express.js, React and Node.js fundamentals: 30 single-choice questions in four sections.",
        durationMinutes: 60,
        totalQuestions: entries.length,
        totalMarks: entries.length * 2,
        passingMarks: 24,
        attemptLimit: 1,
        status: EXAM_STATUS.PUBLISHED,
        instructions: DEFAULT_EXAM_INSTRUCTIONS,
        sections: MERN_101.sections.map(({ id, title }) => ({ id, title })),
        proctoringPolicy: {
          cameraRequired: true,
          microphoneRequired: true,
          // Not implemented in KProctor, so it isn't claimed for this exam.
          screenMonitoringRequired: false,
          fullscreenRequired: true,
          identityVerificationRequired: false,
        },
        securityPolicy: {
          allowTabSwitch: false,
          allowExternalDevices: false,
          allowBackNavigation: false,
          allowPause: false,
          autoSubmitOnExpiry: true,
        },
        startAt,
        endAt,
        updatedAt: now,
      },
    },
    { upsert: true, returnDocument: "after" },
  );
  if (!exam) throw new Error("Exam upsert failed.");

  await Promise.all(
    entries.map(({ sectionId, q: [prompt, options, correct, topic, difficulty] }, i) =>
      c.questions.updateOne(
        { examId: exam._id, order: i + 1 },
        {
          $setOnInsert: { _id: new ObjectId(), createdAt: now },
          $set: {
            sectionId,
            type: "SINGLE_CHOICE",
            prompt,
            options: options.map((text, n) => ({ id: `opt${n + 1}`, text })),
            correctOptionIds: [`opt${correct + 1}`],
            marks: 2,
            topic,
            difficulty,
            updatedAt: now,
          },
        },
        { upsert: true },
      ),
    ),
  );
  await c.questions.deleteMany({ examId: exam._id, order: { $gt: entries.length } });

  // The dev examiner (if seeded) may review this exam's identity checks / events.
  const examiner = await c.users.findOne({
    role: USER_ROLE.PROCTOR,
    email: "examiner.dev@kodeversity.local",
  });
  if (examiner)
    await c.exams.updateOne({ _id: exam._id }, { $addToSet: { examinerIds: examiner._id } });

  // Answer-key review sheet (private; demo/ is git-ignored).
  const letters = ["A", "B", "C", "D"];
  let n = 0;
  const sheet = [
    `# ${code} — question review (CONFIDENTIAL: contains answers)`,
    "",
    `Window: ${startAt.toISOString()} → ${endAt.toISOString()} · 60 min · ${entries.length} questions · ${entries.length * 2} marks · pass 24`,
    "",
    ...sections.flatMap((s) => [
      `## ${s.title}`,
      "",
      ...s.questions.flatMap(([prompt, options, correct, topic, difficulty]) => [
        `**${++n}. ${prompt}** _(${topic}, ${difficulty.toLowerCase()})_`,
        ...options.map((o, i) => `- ${letters[i]}. ${o}${i === correct ? "  ✅" : ""}`),
        "",
      ]),
    ]),
  ].join("\n");
  mkdirSync(join(process.cwd(), "demo"), { recursive: true });
  const sheetPath = join(process.cwd(), "demo", `${code}-review.md`);
  writeFileSync(sheetPath, sheet);

  console.log(`${code} "${exam.name}" ready (${exam._id.toHexString()})`);
  console.log(`  Window (UTC): ${startAt.toISOString()} → ${endAt.toISOString()}`);
  console.log(
    `  ${entries.length} questions in ${MERN_101.sections.length} sections; review sheet: ${sheetPath}`,
  );
} finally {
  await closeMongoClient();
}

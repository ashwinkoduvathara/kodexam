/**
 * DEVELOPMENT ONLY — seeds a candidate, the CN-2041 exam and the DEMO-101 demo
 * exam, ensures indexes, and prints a signed launch link for each exam.
 *
 *   npm run db:seed            # upsert (keeps existing attempts)
 *   npm run db:seed -- --reset # also clears the dev candidate's attempts for these exams
 */
import { ObjectId } from "mongodb";
import { signCandidateToken } from "@/server/auth/candidate-auth";
import { type ExamDoc, getCollections, USER_ROLE } from "@/server/db/collections";
import { ensureIndexes } from "@/server/db/indexes";
import { closeMongoClient, getDb } from "@/server/db/mongodb";
import { getServerConfig } from "@/server/env";
import { getIdentityConfig } from "@/server/identity/config";
import { DEFAULT_EXAM_INSTRUCTIONS, EXAM_STATUS } from "@/types/exam";
import { CN_2041, DEMO_101, type QuestionBank } from "./seed-data/questions";

const DAY = 24 * 60 * 60 * 1000;

async function main() {
  const { mongodbDbName } = getServerConfig();
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run the development seed with NODE_ENV=production.");
  }
  const reset = process.argv.includes("--reset");
  const db = await getDb();
  const c = getCollections(db);
  const now = new Date();

  await ensureIndexes(db, { auditRetentionDays: getIdentityConfig().auditRetentionDays });

  const candidate = await c.users.findOneAndUpdate(
    { rollNumber: "123456789" },
    {
      $setOnInsert: { _id: new ObjectId(), role: USER_ROLE.CANDIDATE, createdAt: now },
      $set: {
        name: "Jaydeep Das",
        email: null,
        avatarUrl: null,
        status: "ACTIVE",
        updatedAt: now,
      },
    },
    { upsert: true, returnDocument: "after" },
  );

  const upsertExam = (examCode: string, fields: Partial<ExamDoc>) =>
    c.exams.findOneAndUpdate(
      { examCode },
      {
        $setOnInsert: { _id: new ObjectId(), createdBy: null, createdAt: now },
        $set: {
          status: EXAM_STATUS.PUBLISHED,
          instructions: DEFAULT_EXAM_INSTRUCTIONS,
          securityPolicy: {
            allowTabSwitch: false,
            allowExternalDevices: false,
            allowBackNavigation: false,
            allowPause: false,
            autoSubmitOnExpiry: true,
          },
          startAt: new Date(now.getTime() - DAY),
          endAt: new Date(now.getTime() + 30 * DAY),
          updatedAt: now,
          ...fields,
        },
      },
      { upsert: true, returnDocument: "after" },
    );

  const exam = await upsertExam("CN-2041", {
    name: "Computer Network",
    description: "Fundamentals of computer networking: OSI/TCP-IP models, routing and protocols.",
    durationMinutes: 90,
    totalQuestions: 50,
    totalMarks: 100,
    passingMarks: 40,
    attemptLimit: 1,
    proctoringPolicy: {
      cameraRequired: true,
      microphoneRequired: true,
      screenMonitoringRequired: true,
      fullscreenRequired: true,
      identityVerificationRequired: true,
      // Candidates wait for a reviewer's decision when automated verification is uncertain.
      identityReviewPolicy: "BLOCK",
    },
  });

  // Demo exam: short, many attempts, and candidates may continue while their
  // identity check awaits review (so a demo doesn't need the reviewer script).
  const demoExam = await upsertExam("DEMO-101", {
    name: "KProctor Demo Exam",
    description: "A short practice exam for trying the KProctor pre-exam flow end to end.",
    durationMinutes: 30,
    totalQuestions: 10,
    totalMarks: 20,
    passingMarks: 8,
    attemptLimit: 20,
    proctoringPolicy: {
      cameraRequired: true,
      microphoneRequired: true,
      screenMonitoringRequired: true,
      fullscreenRequired: true,
      identityVerificationRequired: true,
      identityReviewPolicy: "ALLOW_PENDING_REVIEW",
    },
  });

  if (!candidate || !exam || !demoExam) throw new Error("Seed upsert failed.");

  /**
   * Sections + questions, upserted by (exam, order) so re-seeding keeps question
   * ids stable and never orphans saved answers. totalQuestions follows the bank.
   */
  const seedQuestions = async (examDoc: ExamDoc, bank: QuestionBank) => {
    const entries = bank.sections.flatMap((s) => s.questions.map((q) => ({ sectionId: s.id, q })));
    await Promise.all(
      entries.map(({ sectionId, q: [prompt, options, correct, topic, difficulty] }, i) => {
        const ids = options.map((_, n) => `opt${n + 1}`);
        return c.questions.updateOne(
          { examId: examDoc._id, order: i + 1 },
          {
            $setOnInsert: { _id: new ObjectId(), createdAt: now },
            $set: {
              sectionId,
              type: "SINGLE_CHOICE",
              prompt,
              options: options.map((text, n) => ({ id: ids[n], text })),
              correctOptionIds: [ids[correct]],
              marks: 2,
              topic,
              difficulty,
              updatedAt: now,
            },
          },
          { upsert: true },
        );
      }),
    );
    await c.questions.deleteMany({ examId: examDoc._id, order: { $gt: entries.length } });
    await c.exams.updateOne(
      { _id: examDoc._id },
      {
        $set: {
          sections: bank.sections.map(({ id, title }) => ({ id, title })),
          totalQuestions: entries.length,
          totalMarks: entries.length * 2,
        },
      },
    );
  };
  await seedQuestions(exam, CN_2041);
  await seedQuestions(demoExam, DEMO_101);

  // Development examiner, assigned to this exam (reviews identity verifications).
  const examiner = await c.users.findOneAndUpdate(
    { email: "examiner.dev@kodeversity.local" },
    {
      $setOnInsert: { _id: new ObjectId(), role: USER_ROLE.PROCTOR, createdAt: now },
      $set: {
        name: "Dev Examiner",
        rollNumber: null,
        avatarUrl: null,
        status: "ACTIVE",
        updatedAt: now,
      },
    },
    { upsert: true, returnDocument: "after" },
  );
  await c.exams.updateMany(
    { _id: { $in: [exam._id, demoExam._id] } },
    { $addToSet: { examinerIds: examiner!._id } },
  );

  if (reset) {
    const attempts = await c.examAttempts
      .find(
        { examId: { $in: [exam._id, demoExam._id] }, candidateId: candidate._id },
        { projection: { _id: 1 } },
      )
      .toArray();
    const ids = attempts.map((a) => a._id);
    await Promise.all([
      c.examAttempts.deleteMany({ _id: { $in: ids } }),
      c.examSessions.deleteMany({ attemptId: { $in: ids } }),
      c.auditLogs.deleteMany({ attemptId: { $in: ids } }),
      c.identityVerifications.deleteMany({ attemptId: { $in: ids } }),
      c.candidateAnswers.deleteMany({ attemptId: { $in: ids } }),
      c.proctoringEvents.deleteMany({ attemptId: { $in: ids } }),
    ]);
    console.log(`Reset ${ids.length} attempt(s).`);
  }

  const appUrl = process.env.KPROCTOR_APP_URL ?? "http://localhost:3100";
  const token = signCandidateToken(candidate._id.toHexString());
  console.log(`Seeded database "${mongodbDbName}".`);
  console.log(`  Candidate: ${candidate.name} (${candidate._id.toHexString()})`);
  for (const e of [exam, demoExam]) {
    const next = `/exam/${e._id.toHexString()}`;
    console.log(`
${e.examCode} ${e.name} (${e._id.toHexString()})`);
    console.log(
      `Launch link (valid 8 hours):
${appUrl}/api/auth/launch?token=${token}&next=${encodeURIComponent(next)}`,
    );
  }
  console.log("");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeMongoClient());

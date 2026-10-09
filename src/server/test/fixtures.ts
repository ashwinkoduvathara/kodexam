import { ObjectId, type Db } from "mongodb";
import { DEFAULT_EXAM_INSTRUCTIONS, EXAM_STATUS } from "@/types/exam";
import { signCandidateToken } from "../auth/candidate-auth";
import {
  getCollections,
  USER_ROLE,
  type ExamDoc,
  type QuestionDoc,
  type UserDoc,
} from "../db/collections";
import { ensureIndexes } from "../db/indexes";
import { getDb } from "../db/mongodb";

/** The test database. Refuses to touch anything not explicitly named *_test. */
export async function getTestDb(): Promise<Db> {
  const db = await getDb();
  if (!db.databaseName.endsWith("_test")) {
    throw new Error(`Refusing to use non-test database "${db.databaseName}"`);
  }
  return db;
}

export async function resetTestDb(): Promise<Db> {
  const db = await getTestDb();
  await db.dropDatabase();
  await ensureIndexes(db);
  return db;
}

export async function createCandidate(db: Db, overrides: Partial<UserDoc> = {}): Promise<UserDoc> {
  const now = new Date();
  const doc: UserDoc = {
    _id: new ObjectId(),
    role: USER_ROLE.CANDIDATE,
    name: "Test Candidate",
    email: null,
    rollNumber: `R-${new ObjectId().toHexString().slice(-8)}`,
    avatarUrl: null,
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  await getCollections(db).users.insertOne(doc);
  return doc;
}

export async function createExam(db: Db, overrides: Partial<ExamDoc> = {}): Promise<ExamDoc> {
  const now = new Date();
  const doc: ExamDoc = {
    _id: new ObjectId(),
    examCode: `T-${new ObjectId().toHexString().slice(-6).toUpperCase()}`,
    name: "Integration Test Exam",
    description: "",
    durationMinutes: 75,
    totalQuestions: 42,
    totalMarks: 120,
    passingMarks: 48,
    attemptLimit: 1,
    status: EXAM_STATUS.PUBLISHED,
    instructions: DEFAULT_EXAM_INSTRUCTIONS,
    proctoringPolicy: {
      cameraRequired: true,
      microphoneRequired: true,
      screenMonitoringRequired: true,
      fullscreenRequired: true,
      identityVerificationRequired: true,
    },
    securityPolicy: {
      allowTabSwitch: false,
      allowExternalDevices: false,
      allowBackNavigation: false,
      allowPause: false,
      autoSubmitOnExpiry: true,
    },
    startAt: new Date(now.getTime() - 60 * 60_000),
    endAt: new Date(now.getTime() + 24 * 60 * 60_000),
    createdBy: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  await getCollections(db).exams.insertOne(doc);
  return doc;
}

export const ALL_PASSED = {
  camera: "passed",
  microphone: "passed",
  speaker: "passed",
  network: "passed",
} as const;

export function apiRequest(
  path: string,
  options: { method?: "GET" | "POST"; candidate?: UserDoc; body?: unknown; origin?: string } = {},
) {
  const headers = new Headers({ host: "localhost:3100", "user-agent": "vitest-agent" });
  if (options.candidate) {
    headers.set(
      "authorization",
      `Bearer ${signCandidateToken(options.candidate._id.toHexString())}`,
    );
  }
  if (options.origin) headers.set("origin", options.origin);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  return new Request(`http://localhost:3100${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

/**
 * Inserts `count` single-choice questions for an exam (options a–d, correct "b"),
 * split across the given sections in order.
 */
export async function createQuestions(
  db: Db,
  exam: ExamDoc,
  count: number,
  sectionIds: string[] = [],
): Promise<QuestionDoc[]> {
  const now = new Date();
  const perSection = sectionIds.length ? Math.ceil(count / sectionIds.length) : count;
  const docs: QuestionDoc[] = Array.from({ length: count }, (_, i) => ({
    _id: new ObjectId(),
    examId: exam._id,
    order: i + 1,
    sectionId: sectionIds.length ? sectionIds[Math.floor(i / perSection)] : null,
    type: "SINGLE_CHOICE",
    prompt: `Test question ${i + 1}?`,
    options: ["a", "b", "c", "d"].map((id) => ({ id, text: `Option ${id.toUpperCase()}` })),
    correctOptionIds: ["b"],
    marks: 2,
    topic: "Testing",
    difficulty: "EASY",
    createdAt: now,
    updatedAt: now,
  }));
  if (docs.length) await getCollections(db).questions.insertMany(docs);
  return docs;
}

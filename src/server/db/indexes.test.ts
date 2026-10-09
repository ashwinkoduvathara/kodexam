import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoServerError, ObjectId, type Db } from "mongodb";
import { LAUNCH_TOKENS_COLLECTION } from "../auth/lms-launch";
import { createCandidate, createExam, resetTestDb } from "../test/fixtures";
import { getCollections } from "./collections";
import { ensureIndexes } from "./indexes";
import { closeMongoClient } from "./mongodb";
import { withTransaction } from "./transactions";

let db: Db;
beforeAll(async () => {
  db = await resetTestDb();
  await ensureIndexes(db, { auditRetentionDays: null });
});
afterAll(async () => {
  await (await resetTestDb()).dropDatabase();
  await closeMongoClient();
});

const indexes = async (collection: string) =>
  Object.fromEntries((await db.collection(collection).indexes()).map((i) => [i.name, i]));

describe("required indexes", () => {
  it("exist with the right uniqueness / TTL settings", async () => {
    const required: Record<string, Record<string, { unique?: boolean; ttl?: boolean }>> = {
      examAttempts: {
        exam_candidate_attempt_unique: { unique: true },
        status_expiresAt: {},
      },
      candidateAnswers: { attempt_question_unique: { unique: true } },
      identityVerifications: { attemptId_unique: { unique: true } },
      users: { lmsUserId_unique: { unique: true }, email_unique: { unique: true } },
      questions: { exam_order_unique: { unique: true } },
      proctoringEvents: { attempt_occurredAt: {} },
      rateLimits: { expiresAt_ttl: { ttl: true } },
      [LAUNCH_TOKENS_COLLECTION]: { expiresAt_ttl: { ttl: true } },
    };
    for (const [collection, expected] of Object.entries(required)) {
      const present = await indexes(collection);
      for (const [name, opts] of Object.entries(expected)) {
        expect(present[name], `${collection}.${name}`).toBeDefined();
        if (opts.unique) expect(present[name].unique, `${collection}.${name} unique`).toBe(true);
        if (opts.ttl) expect(present[name].expireAfterSeconds, `${collection}.${name} ttl`).toBe(0);
      }
    }
  });
});

describe("constraints and transactions on the replica set", () => {
  it("rejects a second attempt with the same (exam, candidate, number)", async () => {
    const exam = await createExam(db);
    const candidate = await createCandidate(db);
    const attempt = {
      examId: exam._id,
      candidateId: candidate._id,
      attemptNumber: 1,
    } as const;
    const c = getCollections(db).examAttempts;
    await c.insertOne({ _id: new ObjectId(), ...attempt } as never);
    const error = await c.insertOne({ _id: new ObjectId(), ...attempt } as never).catch((e) => e);
    expect(error).toBeInstanceOf(MongoServerError);
    expect((error as MongoServerError).code).toBe(11000);
  });

  it("rolls back every write when a transaction fails", async () => {
    const c = getCollections(db);
    const before = await c.auditLogs.countDocuments({});
    await expect(
      withTransaction(async (session) => {
        await c.auditLogs.insertOne({ _id: new ObjectId(), eventType: "X" } as never, { session });
        await c.proctoringEvents.insertOne({ _id: new ObjectId() } as never, { session });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect(await c.auditLogs.countDocuments({})).toBe(before);
    expect(await c.proctoringEvents.countDocuments({})).toBe(0);
  });
});

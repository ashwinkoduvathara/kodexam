import "@tanstack/react-start/server-only";
import type { ClientSession, Db, ObjectId } from "mongodb";
import { getCollections, type ExamSessionDoc } from "../db/collections";

export function createExamSessionRepository(db: Db) {
  const { examSessions } = getCollections(db);
  return {
    findByAttempt(attemptId: ObjectId): Promise<ExamSessionDoc | null> {
      return examSessions.findOne({ attemptId });
    },

    /** Creates the frozen snapshot once; later calls keep the original policy. */
    async ensure(doc: ExamSessionDoc): Promise<ExamSessionDoc> {
      const { _id, lastSeenAt, updatedAt, ...immutable } = doc;
      const result = await examSessions.findOneAndUpdate(
        { attemptId: doc.attemptId },
        {
          $setOnInsert: { _id, ...immutable },
          $set: { lastSeenAt, updatedAt },
        },
        { upsert: true, returnDocument: "after" },
      );
      return result!;
    },

    /** The snapshot's deadline follows the attempt's once the exam timer starts. */
    async setExamEndTime(
      attemptId: ObjectId,
      examEndTime: Date,
      now: Date,
      session?: ClientSession,
    ): Promise<void> {
      await examSessions.updateOne(
        { attemptId },
        { $set: { examEndTime, updatedAt: now } },
        { session },
      );
    },

    async touch(attemptId: ObjectId, now: Date): Promise<void> {
      await examSessions.updateOne({ attemptId }, { $set: { lastSeenAt: now, updatedAt: now } });
    },
  };
}
export type ExamSessionRepository = ReturnType<typeof createExamSessionRepository>;

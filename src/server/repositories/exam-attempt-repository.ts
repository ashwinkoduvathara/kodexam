import "@tanstack/react-start/server-only";
import type { ClientSession, Db, MatchKeysAndValues, ObjectId } from "mongodb";
import { ATTEMPT_STATUS, type AttemptStatus } from "@/types/exam-attempt";
import { getCollections, type ExamAttemptDoc } from "../db/collections";

export function createExamAttemptRepository(db: Db) {
  const { examAttempts } = getCollections(db);

  return {
    findLatest(examId: ObjectId, candidateId: ObjectId): Promise<ExamAttemptDoc | null> {
      return examAttempts.findOne({ examId, candidateId }, { sort: { attemptNumber: -1 } });
    },

    /** Ownership is part of the query: another candidate's attempt is simply "not found". */
    findOwned(attemptId: ObjectId, candidateId: ObjectId): Promise<ExamAttemptDoc | null> {
      return examAttempts.findOne({ _id: attemptId, candidateId });
    },

    async insert(doc: ExamAttemptDoc): Promise<void> {
      await examAttempts.insertOne(doc);
    },

    /**
     * Atomic state transition. Applies only if the attempt is owned by the
     * candidate, is currently in one of `from`, and hasn't expired — so two
     * concurrent requests can't both move it forward.
     */
    transition(params: {
      attemptId: ObjectId;
      candidateId: ObjectId;
      from: readonly AttemptStatus[];
      now: Date;
      set: MatchKeysAndValues<ExamAttemptDoc>;
      session?: ClientSession;
    }): Promise<ExamAttemptDoc | null> {
      const { attemptId, candidateId, from, now, set, session } = params;
      return examAttempts.findOneAndUpdate(
        { _id: attemptId, candidateId, status: { $in: [...from] }, expiresAt: { $gt: now } },
        { $set: { ...set, updatedAt: now } },
        { returnDocument: "after", session },
      );
    },
  };
}
export type ExamAttemptRepository = ReturnType<typeof createExamAttemptRepository>;

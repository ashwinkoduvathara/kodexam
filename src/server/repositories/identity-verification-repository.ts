import "@tanstack/react-start/server-only";
import type { ClientSession, Db, MatchKeysAndValues, ObjectId } from "mongodb";
import type { IdentityVerificationStatus } from "@/types/identity";
import { getCollections, type IdentityVerificationDoc } from "../db/collections";

export function createIdentityVerificationRepository(db: Db) {
  const { identityVerifications } = getCollections(db);

  return {
    findByAttempt(attemptId: ObjectId, session?: ClientSession) {
      return identityVerifications.findOne({ attemptId }, { session });
    },

    findById(id: ObjectId) {
      return identityVerifications.findOne({ _id: id });
    },

    async insert(doc: IdentityVerificationDoc, session?: ClientSession) {
      await identityVerifications.insertOne(doc, { session });
    },

    /**
     * Optimistic-concurrency update: applies only if the record is still at
     * `expectedVersion` and `expectedStatus`. Returns the updated document, or
     * null if someone else changed it first.
     */
    update(params: {
      id: ObjectId;
      expectedVersion: number;
      expectedStatus: IdentityVerificationStatus;
      set: MatchKeysAndValues<IdentityVerificationDoc>;
      now: Date;
      session: ClientSession;
    }) {
      return identityVerifications.findOneAndUpdate(
        { _id: params.id, version: params.expectedVersion, status: params.expectedStatus },
        { $set: { ...params.set, updatedAt: params.now }, $inc: { version: 1 } },
        { returnDocument: "after", session: params.session },
      );
    },

    findDueForPurge(now: Date, limit = 100) {
      return identityVerifications
        .find({ dataExpiresAt: { $lte: now } })
        .limit(limit)
        .toArray();
    },
  };
}
export type IdentityVerificationRepository = ReturnType<
  typeof createIdentityVerificationRepository
>;

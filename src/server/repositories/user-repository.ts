import "@tanstack/react-start/server-only";
import type { Db, ObjectId } from "mongodb";
import { getCollections, USER_ROLE, type UserDoc } from "../db/collections";

export function createUserRepository(db: Db) {
  const { users } = getCollections(db);
  return {
    findActiveCandidate(candidateId: ObjectId): Promise<UserDoc | null> {
      return users.findOne({ _id: candidateId, role: USER_ROLE.CANDIDATE, status: "ACTIVE" });
    },
    /** Examiners (proctors) and admins — the only roles that may review identity evidence. */
    findActiveStaff(userId: ObjectId): Promise<UserDoc | null> {
      return users.findOne({
        _id: userId,
        role: { $in: [USER_ROLE.PROCTOR, USER_ROLE.ADMIN] },
        status: "ACTIVE",
      });
    },
  };
}
export type UserRepository = ReturnType<typeof createUserRepository>;

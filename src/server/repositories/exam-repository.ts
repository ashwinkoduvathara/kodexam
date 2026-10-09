import "@tanstack/react-start/server-only";
import { ObjectId, type Db } from "mongodb";
import { getCollections, type ExamDoc } from "../db/collections";

export function createExamRepository(db: Db) {
  const { exams } = getCollections(db);
  return {
    findById(id: ObjectId): Promise<ExamDoc | null> {
      return exams.findOne({ _id: id });
    },
    findByCode(examCode: string): Promise<ExamDoc | null> {
      return exams.findOne({ examCode: examCode.toUpperCase() });
    },
    /** Exams are addressed by ObjectId; the exam code is accepted as a readable alias. */
    findByRef(ref: string): Promise<ExamDoc | null> {
      if (/^[a-f\d]{24}$/i.test(ref)) return this.findById(new ObjectId(ref));
      return this.findByCode(ref);
    },
  };
}
export type ExamRepository = ReturnType<typeof createExamRepository>;

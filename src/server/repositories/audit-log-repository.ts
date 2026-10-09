import "@tanstack/react-start/server-only";
import { ObjectId, type ClientSession, type Db } from "mongodb";
import {
  getCollections,
  type AuditActorType,
  type AuditEvent,
  type AuditLogDoc,
} from "../db/collections";

export interface AuditContext {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AuditEntry {
  eventType: AuditEvent;
  attemptId: ObjectId | null;
  examId: ObjectId | null;
  candidateId: ObjectId | null;
  actorType: AuditActorType;
  actorId: ObjectId | null;
  context: AuditContext;
  /** Identifiers, statuses and codes only — never personal or document data. */
  metadata?: Record<string, unknown>;
  /** Server-generated time (UTC). */
  at: Date;
}

export function createAuditLogRepository(db: Db) {
  const { auditLogs } = getCollections(db);
  return {
    /** Pass `session` to commit the event atomically with the state change it records. */
    async record(entry: AuditEntry, session?: ClientSession): Promise<void> {
      const doc: AuditLogDoc = {
        _id: new ObjectId(),
        eventType: entry.eventType,
        timestamp: entry.at,
        actorType: entry.actorType,
        actorId: entry.actorId,
        attemptId: entry.attemptId,
        examId: entry.examId,
        candidateId: entry.candidateId,
        ipAddress: entry.context.ipAddress,
        userAgent: entry.context.userAgent,
        metadata: entry.metadata ?? {},
      };
      await auditLogs.insertOne(doc, { session });
    },

    listForAttempt(attemptId: ObjectId): Promise<AuditLogDoc[]> {
      return auditLogs.find({ attemptId }).sort({ timestamp: 1, _id: 1 }).toArray();
    },
  };
}
export type AuditLogRepository = ReturnType<typeof createAuditLogRepository>;

import "@tanstack/react-start/server-only";
import { MongoServerError, type ClientSession } from "mongodb";
import { getMongoClient } from "./mongodb";

/**
 * Runs `fn` in a multi-document ACID transaction (majority write concern).
 * Used wherever a state change and its audit event must commit together.
 *
 * Transactions require a replica set or sharded cluster (MongoDB Atlas always
 * is). On a standalone server this throws TransactionsUnavailableError instead
 * of silently writing non-atomically.
 */
export class TransactionsUnavailableError extends Error {
  constructor() {
    super("MongoDB transactions require a replica set.");
    this.name = "TransactionsUnavailableError";
  }
}

/**
 * Runs `fn` in a transaction where the deployment supports it. On a standalone
 * server it runs without one; callers must then rely on conditional
 * single-document updates for correctness.
 */
export async function inTransactionIfSupported<T>(
  fn: (session: ClientSession | undefined) => Promise<T>,
): Promise<T> {
  try {
    return await withTransaction((session) => fn(session));
  } catch (error) {
    if (error instanceof TransactionsUnavailableError) return fn(undefined);
    throw error;
  }
}

export async function withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const client = await getMongoClient();
  const session = client.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(
      async () => {
        result = await fn(session);
      },
      { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
    );
    return result as T;
  } catch (error) {
    if (
      error instanceof MongoServerError &&
      (error.code === 20 || /Transaction numbers are only allowed/.test(error.message))
    ) {
      throw new TransactionsUnavailableError();
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

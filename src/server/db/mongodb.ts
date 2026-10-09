import "@tanstack/react-start/server-only";
import { MongoClient, type Db } from "mongodb";
import { getServerConfig } from "../env";

/**
 * Shared MongoClient. One client (with its own connection pool) per process —
 * cached on globalThis so Vite's dev-mode module reloads reuse it instead of
 * opening a new pool on every edit or request.
 */

interface MongoCache {
  uri: string | null;
  client: MongoClient | null;
  promise: Promise<MongoClient> | null;
}

const globalForMongo = globalThis as typeof globalThis & { __kproctorMongo?: MongoCache };
const cache: MongoCache = (globalForMongo.__kproctorMongo ??= {
  uri: null,
  client: null,
  promise: null,
});

export class DatabaseUnavailableError extends Error {
  constructor(cause?: unknown) {
    // Never include the connection string — it may contain credentials.
    super("The database is currently unavailable.", { cause });
    this.name = "DatabaseUnavailableError";
  }
}

export async function getMongoClient(): Promise<MongoClient> {
  const { mongodbUri } = getServerConfig();
  if (cache.client && cache.uri === mongodbUri) return cache.client;

  if (!cache.promise || cache.uri !== mongodbUri) {
    cache.uri = mongodbUri;
    const client = new MongoClient(mongodbUri, {
      appName: "kproctor",
      maxPoolSize: 20,
      serverSelectionTimeoutMS: 5_000,
      connectTimeoutMS: 5_000,
    });
    cache.promise = client
      .connect()
      .then((connected) => {
        cache.client = connected;
        return connected;
      })
      .catch((error: unknown) => {
        // Allow the next request to retry instead of caching the failure.
        cache.promise = null;
        cache.client = null;
        throw new DatabaseUnavailableError(error);
      });
  }
  return cache.promise;
}

export async function getDb(dbName?: string): Promise<Db> {
  const client = await getMongoClient();
  return client.db(dbName ?? getServerConfig().mongodbDbName);
}

/** For scripts and tests. Request handlers never close the shared client. */
export async function closeMongoClient(): Promise<void> {
  const client = cache.client ?? (cache.promise ? await cache.promise.catch(() => null) : null);
  cache.client = null;
  cache.promise = null;
  cache.uri = null;
  await client?.close();
}

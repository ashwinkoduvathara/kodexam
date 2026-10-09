/**
 * Starts a single-node MongoDB replica set from the locally installed `mongod`
 * binary. Transactions (used by identity verification) need a replica set;
 * a standalone server can't run them.
 *
 * Used by `npm run db:replset` (development) and the Vitest global setup
 * (ephemeral, per test run). Never touches any existing MongoDB service.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MongoClient } from "mongodb";

export function findMongod(): string {
  if (process.env.MONGOD_PATH) return process.env.MONGOD_PATH;
  if (process.platform === "win32") {
    const root = "C:/Program Files/MongoDB/Server";
    if (existsSync(root)) {
      const versions = readdirSync(root)
        .filter((v) => existsSync(join(root, v, "bin", "mongod.exe")))
        .sort((a, b) => Number.parseFloat(b) - Number.parseFloat(a));
      if (versions[0]) return join(root, versions[0], "bin", "mongod.exe");
    }
  }
  return "mongod";
}

export interface ReplicaSet {
  uri: string;
  process: ChildProcess;
  stop(): Promise<void>;
}

async function waitFor<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Timed out waiting for mongod");
}

export async function startReplicaSet(options: {
  port: number;
  dbPath: string;
  replSet?: string;
  quiet?: boolean;
}): Promise<ReplicaSet> {
  const replSet = options.replSet ?? "rs0";
  mkdirSync(options.dbPath, { recursive: true });

  const child = spawn(
    findMongod(),
    [
      "--replSet",
      replSet,
      "--port",
      String(options.port),
      "--bind_ip",
      "127.0.0.1",
      "--dbpath",
      options.dbPath,
      ...(options.quiet ? ["--quiet"] : []),
    ],
    { stdio: options.quiet ? "ignore" : "inherit", windowsHide: true },
  );
  child.on("error", (e) => console.error(`[replica-set] failed to start mongod: ${e.message}`));

  const direct = `mongodb://127.0.0.1:${options.port}/?directConnection=true`;
  await waitFor(async () => {
    const c = new MongoClient(direct, { serverSelectionTimeoutMS: 1000 });
    try {
      await c.connect();
      const admin = c.db("admin");
      const hello = await admin.command({ hello: 1 });
      if (!hello.setName) {
        await admin
          .command({
            replSetInitiate: {
              _id: replSet,
              members: [{ _id: 0, host: `127.0.0.1:${options.port}` }],
            },
          })
          .catch((e: { codeName?: string }) => {
            if (e.codeName !== "AlreadyInitialized") throw e;
          });
      }
      const status = await admin.command({ hello: 1 });
      if (!status.isWritablePrimary) throw new Error("not primary yet");
    } finally {
      await c.close();
    }
  }, 30_000);

  return {
    uri: `mongodb://127.0.0.1:${options.port}/?replicaSet=${replSet}&directConnection=true`,
    process: child,
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once("exit", () => resolve());
        child.kill();
      }),
  };
}

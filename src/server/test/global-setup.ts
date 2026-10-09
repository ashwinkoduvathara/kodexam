import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import { startReplicaSet, type ReplicaSet } from "../../../scripts/lib/replica-set";

declare module "vitest" {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

let rs: ReplicaSet | undefined;
let dir: string | undefined;

/** Ephemeral replica set for the test run, so transactions are exercised for real. */
export async function setup(project: TestProject) {
  dir = mkdtempSync(join(tmpdir(), "kproctor-test-rs-"));
  const port = 27100 + Math.floor(Math.random() * 400);
  rs = await startReplicaSet({ port, dbPath: dir, quiet: true });
  project.provide("mongoUri", rs.uri);
}

export async function teardown() {
  await rs?.stop();
  if (dir) rmSync(dir, { recursive: true, force: true });
}

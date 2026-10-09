import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inject } from "vitest";
import { loadServerEnv } from "../env";

// Server tests run against an ephemeral replica set (see global-setup.ts) in an
// isolated database that is dropped between tests.
loadServerEnv();
process.env.MONGODB_URI = inject("mongoUri");
process.env.MONGODB_DB_NAME = "kodeproctor_test";
process.env.KPROCTOR_AUTH_SECRET = "test-secret-for-kproctor-integration-tests-only";

// Identity: encrypted local storage in a throwaway directory, test-only key, no scanner.
process.env.KPROCTOR_IDENTITY_STORAGE = "local";
process.env.KPROCTOR_IDENTITY_LOCAL_DIR = mkdtempSync(join(tmpdir(), "kproctor-test-objects-"));
process.env.KPROCTOR_IDENTITY_MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.KPROCTOR_MALWARE_SCANNER = "none";

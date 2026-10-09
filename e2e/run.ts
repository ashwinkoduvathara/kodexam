/**
 * KProctor browser test runner.
 *
 *   npm run test:e2e                      # all suites
 *   E2E_ONLY=S2,T1 npm run test:e2e       # scenarios whose name starts with these prefixes
 *
 * The app must be running (E2E_BASE_URL, default http://localhost:3100) against
 * the same MongoDB as this process. Fixtures are E2E-prefixed and removed afterwards.
 */
import { mkdirSync } from "node:fs";
import { closeMongoClient } from "@/server/db/mongodb";
import { runIdentitySuite } from "./identity.e2e";
import { runInstructionsSuite } from "./instructions.e2e";
import { cleanupE2E, OUT, summary } from "./lib";
import { runStartSuite } from "./start.e2e";
import { runActiveSuite } from "./active.e2e";
import { runSystemCheckSuite } from "./system-check.e2e";

mkdirSync(OUT, { recursive: true });
let ok = false;
try {
  await cleanupE2E();
  console.log("— Screen 2: Exam Instructions —");
  await runInstructionsSuite();
  console.log("\n— Screen 3: Identity Verification —");
  await runIdentitySuite();
  console.log("\n— Screen 4: Start Exam —");
  await runStartSuite();
  console.log("\n— Active Exam —");
  await runActiveSuite();
  console.log("\n— Screen 1: System Check (regression) —");
  await runSystemCheckSuite();
  ok = summary();
} finally {
  await cleanupE2E();
  await closeMongoClient();
}
process.exit(ok ? 0 : 1);

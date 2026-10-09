/**
 * DEVELOPMENT stand-in for the LMS: signs a launch token with a private key
 * from `npm run lms:keygen` and prints a one-time launch URL.
 *
 *   npm run lms:launch -- <private-key.pem> <lmsUserId> <examCode> "<Full Name>"
 *
 * Requires KPROCTOR_LMS_LAUNCH_PUBLIC_KEY / KPROCTOR_LMS_ISSUER on the KProctor side.
 * The link works once and expires in 60 seconds.
 */
import { readFileSync } from "node:fs";
import { loadServerEnv } from "@/server/env";
import { createKProctorLaunch } from "../integrations/lms/kproctor-launch";

loadServerEnv();
const [keyPath, lmsUserId, exam, name] = process.argv.slice(2);
if (!keyPath || !lmsUserId || !exam || !name) {
  console.error(
    'Usage: npm run lms:launch -- <private-key.pem> <lmsUserId> <examCode> "<Full Name>"',
  );
  process.exit(1);
}
const issuer = process.env.KPROCTOR_LMS_ISSUER;
if (!issuer) {
  console.error("Set KPROCTOR_LMS_ISSUER first.");
  process.exit(1);
}
const launch = createKProctorLaunch({
  privateKey: readFileSync(keyPath, "utf8"),
  issuer,
  kproctorUrl: process.env.KPROCTOR_APP_URL ?? "http://localhost:3100",
  lmsUserId,
  exam,
  name,
});
console.log(`One-time launch link (60 s):\n${launch.action}?token=${launch.token}`);

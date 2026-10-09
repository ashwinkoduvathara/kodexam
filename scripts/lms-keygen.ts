/**
 * Generates an Ed25519 key pair for LMS → KProctor launches.
 *
 *   npm run lms:keygen
 *
 * Prints the PUBLIC key for KProctor (KPROCTOR_LMS_LAUNCH_PUBLIC_KEY) and writes
 * the PRIVATE key to a 0600 file for the LMS secret store. Never commit either file
 * of a real deployment; never give KProctor the private key.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const dir = join(process.cwd(), ".data", "lms-launch-keys");
mkdirSync(dir, { recursive: true });
const privatePath = join(dir, `lms-launch-private-${Date.now()}.pem`);
writeFileSync(privatePath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64");

console.log(`Private key (LMS only, keep secret): ${privatePath}`);
console.log(`\nKProctor configuration:\nKPROCTOR_LMS_LAUNCH_PUBLIC_KEY=${spki}`);

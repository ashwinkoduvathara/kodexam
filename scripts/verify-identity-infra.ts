/**
 * Verifies the PRODUCTION identity infrastructure against the real services
 * configured in the environment. Never uses development storage.
 *
 *   npm run verify:identity-infra
 *
 * Checks (each PASS / FAIL / BLOCKED):
 *   ClamAV  - the EICAR test file is detected; a clean image passes; outage → ERROR
 *   S3      - upload is encrypted with SSE-KMS using the configured key
 *           - the object is NOT readable anonymously (private bucket)
 *           - Block Public Access is fully enabled on the bucket
 *           - a presigned URL works now and is refused after it expires
 *           - the test object is deleted afterwards
 *
 * Exit code: 0 = all passed, 1 = a check failed, 2 = blocked (service not configured
 * or unreachable). A blocked run is NOT a pass.
 */
import { GetPublicAccessBlockCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { loadServerEnv } from "@/server/env";
import { sha256Hex } from "@/server/identity/crypto";
import { createClamAvScanner } from "@/server/identity/malware-scanner";
import { createS3Storage } from "@/server/identity/storage/s3-storage";
import { newObjectKey } from "@/server/identity/storage/types";
import { fakePng } from "@/server/test/identity-fixtures";

loadServerEnv();
type Status = "PASS" | "FAIL" | "BLOCKED";
const results: { check: string; status: Status; detail: string }[] = [];
const note = (check: string, status: Status, detail = "") => {
  results.push({ check, status, detail });
  console.log(`${status.padEnd(7)} ${check}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const env = process.env;

// Standard antivirus test signature (harmless by design).
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

async function verifyClamAv() {
  const host = env.KPROCTOR_CLAMAV_HOST;
  const port = Number(env.KPROCTOR_CLAMAV_PORT || 3310);
  if (env.KPROCTOR_MALWARE_SCANNER !== "clamav" || !host) {
    note(
      "ClamAV",
      "BLOCKED",
      "KPROCTOR_MALWARE_SCANNER=clamav and KPROCTOR_CLAMAV_HOST not configured",
    );
    return;
  }
  const scanner = createClamAvScanner({ host, port, timeoutMs: 15_000 });
  const infected = await scanner.scan(new TextEncoder().encode(EICAR));
  if (infected.status === "ERROR") {
    note("ClamAV reachable", "BLOCKED", `no usable reply from ${host}:${port}`);
    return;
  }
  note("ClamAV detects EICAR", infected.status === "INFECTED" ? "PASS" : "FAIL", infected.status);
  const cleanResult = await scanner.scan(fakePng());
  note(
    "ClamAV passes a clean image",
    cleanResult.status === "CLEAN" ? "PASS" : "FAIL",
    cleanResult.status,
  );
}

async function verifyS3() {
  const bucket = env.KPROCTOR_S3_BUCKET;
  const region = env.KPROCTOR_S3_REGION;
  const kmsKeyId = env.KPROCTOR_S3_KMS_KEY_ID;
  if (env.KPROCTOR_IDENTITY_STORAGE !== "s3" || !bucket || !region || !kmsKeyId) {
    note(
      "S3 storage",
      "BLOCKED",
      "KPROCTOR_IDENTITY_STORAGE=s3, bucket, region and KMS key not configured",
    );
    return;
  }
  const endpoint = env.KPROCTOR_S3_ENDPOINT || undefined;
  const forcePathStyle = env.KPROCTOR_S3_FORCE_PATH_STYLE === "true";
  const client = new S3Client({ region, endpoint, forcePathStyle, maxAttempts: 2 });
  const storage = createS3Storage({ bucket, region, endpoint, kmsKeyId, forcePathStyle, client });
  const key = newObjectKey("document");
  const body = fakePng();

  let reference: string;
  try {
    ({ reference } = await storage.upload({ key, body, contentType: "image/png" }));
  } catch (error) {
    note("S3 reachable", "BLOCKED", `upload failed (${(error as Error).name})`);
    return;
  }
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    const encrypted =
      head.ServerSideEncryption === "aws:kms" &&
      (!head.SSEKMSKeyId ||
        head.SSEKMSKeyId.endsWith(kmsKeyId.replace(/^alias\//, "")) ||
        head.SSEKMSKeyId.includes(kmsKeyId));
    note(
      "S3 object encrypted with SSE-KMS",
      encrypted ? "PASS" : "FAIL",
      `${head.ServerSideEncryption ?? "none"}`,
    );

    const publicUrl = endpoint
      ? `${endpoint.replace(/\/$/, "")}/${bucket}/${key}`
      : `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
    const anonymous = await fetch(publicUrl);
    note(
      "S3 object not readable anonymously",
      anonymous.status === 403 || anonymous.status === 401 ? "PASS" : "FAIL",
      `HTTP ${anonymous.status}`,
    );

    try {
      const pab = await client.send(new GetPublicAccessBlockCommand({ Bucket: bucket }));
      const c = pab.PublicAccessBlockConfiguration;
      const all = Boolean(
        c?.BlockPublicAcls && c.BlockPublicPolicy && c.IgnorePublicAcls && c.RestrictPublicBuckets,
      );
      note("S3 Block Public Access fully enabled", all ? "PASS" : "FAIL");
    } catch (error) {
      note(
        "S3 Block Public Access fully enabled",
        "BLOCKED",
        `cannot read (${(error as Error).name}); verify in the console`,
      );
    }

    const { url } = await storage.getTemporaryAccess(reference, {
      ttlSeconds: 5,
      contentType: "image/png",
      sha256: sha256Hex(body),
    });
    const now = await fetch(url);
    note(
      "Presigned URL works before expiry",
      now.status === 200 ? "PASS" : "FAIL",
      `HTTP ${now.status}`,
    );
    await sleep(7000);
    const later = await fetch(url);
    note(
      "Presigned URL refused after expiry",
      later.status === 403 ? "PASS" : "FAIL",
      `HTTP ${later.status}`,
    );
  } finally {
    await storage.delete(reference).catch(() => undefined);
    const gone = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })).then(
      () => false,
      () => true,
    );
    note("S3 test object deleted", gone ? "PASS" : "FAIL");
  }
}

await verifyClamAv();
await verifyS3();
const failed = results.some((r) => r.status === "FAIL");
const blocked = results.some((r) => r.status === "BLOCKED");
console.log(`\nResult: ${failed ? "FAILED" : blocked ? "BLOCKED (not a pass)" : "PASSED"}`);
process.exitCode = failed ? 1 : blocked ? 2 : 0;

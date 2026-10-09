/**
 * Failure behaviour of the REAL storage and scanner adapters when their
 * services are unreachable (refused / hanging TCP connections on this machine).
 * These are genuine outages of the actual clients, not mocks — but they do NOT
 * prove the happy path against real S3 or ClamAV (see scripts/verify-identity-infra.ts).
 */
import { createServer, type Server } from "node:net";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import { ObjectId, type Db } from "mongodb";
import { getCollections, type ExamDoc, type UserDoc } from "../db/collections";
import { closeMongoClient } from "../db/mongodb";
import { DomainError } from "../errors";
import { createIdentityVerificationService } from "../services/identity-verification-service";
import { acknowledgeInstructions, startExamAttempt, submitSystemCheck } from "../api/exam-api";
import { ALL_PASSED, apiRequest, createCandidate, createExam, resetTestDb } from "../test/fixtures";
import { fakeJpeg, fakePng } from "../test/identity-fixtures";
import { getIdentityConfig, resetIdentityConfigForTests } from "./config";
import { createClamAvScanner, notConfiguredScanner, type MalwareScanner } from "./malware-scanner";
import { createS3Storage } from "./storage/s3-storage";

let db: Db;
let candidate: UserDoc;
let exam: ExamDoc;
const ctx = { ipAddress: null, userAgent: "vitest" };
const clean: MalwareScanner = { name: "test-clean", scan: async () => ({ status: "CLEAN" }) };

/** A local port with nothing listening (connection refused). */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}

async function attemptAtIdentity() {
  const post = (path: string, body: unknown = {}) =>
    apiRequest(path, { method: "POST", candidate, body });
  const s = (await (
    await startExamAttempt(post(`/api/exams/${exam._id}/attempts`), exam._id.toHexString())
  ).json()) as { attempt: { id: string } };
  const id = s.attempt.id;
  await submitSystemCheck(
    post(`/api/exam-attempts/${id}/system-check`, { results: ALL_PASSED }),
    id,
  );
  await acknowledgeInstructions(post(`/api/exam-attempts/${id}/instructions/acknowledge`), id);
  return id;
}

const doc = {
  bytes: fakePng(),
  declaredMime: "image/png",
  declaredExtension: "png",
  documentType: "PASSPORT",
};

async function expectServiceUnavailable(p: Promise<unknown>) {
  const error = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).status).toBe(503);
  // Candidate-safe message: no hostnames, ports, buckets or SDK details.
  expect((error as DomainError).message).not.toMatch(/127\.0\.0\.1|ECONN|bucket|s3|clam/i);
}

let hanging: Server | null = null;
const hangingSockets = new Set<import("node:net").Socket>();
beforeEach(async () => {
  db = await resetTestDb();
  candidate = await createCandidate(db);
  exam = await createExam(db);
});
afterEach(async () => {
  hangingSockets.forEach((s) => s.destroy());
  hangingSockets.clear();
  if (hanging) await new Promise<void>((r) => hanging!.close(() => r()));
  hanging = null;
});
afterAll(async () => {
  await (await resetTestDb()).dropDatabase();
  await closeMongoClient();
});

describe("scanner outage", () => {
  it("connection refused: the upload fails safely (503) and nothing is stored", async () => {
    const scanner = createClamAvScanner({
      host: "127.0.0.1",
      port: await closedPort(),
      timeoutMs: 2000,
    });
    const svc = createIdentityVerificationService(db, { scanner });
    const id = await attemptAtIdentity();
    await svc.start(id, candidate._id, ctx);
    await svc.capturePhoto(id, candidate._id, fakeJpeg(), ctx);

    await expectServiceUnavailable(svc.uploadDocument(id, candidate._id, doc, ctx));
    const c = getCollections(db);
    const v = await c.identityVerifications.findOne({ attemptId: new ObjectId(id) });
    expect(v!.idDocument).toBeNull();
    expect(v!.status).toBe("PHOTO_CAPTURED"); // unchanged by the failed upload
    const audit = await c.auditLogs.findOne({ eventType: "DOCUMENT_SCAN_COMPLETED" });
    expect(audit!.metadata).toMatchObject({ result: "SCAN_FAILED" });
  });

  it("scanner hangs: times out and fails safely", async () => {
    hanging = createServer((socket) => void hangingSockets.add(socket)); // accepts, never answers
    await new Promise<void>((r) => hanging!.listen(0, "127.0.0.1", r));
    const { port } = hanging.address() as { port: number };
    const scanner = createClamAvScanner({ host: "127.0.0.1", port, timeoutMs: 800 });
    const started = Date.now();
    expect(await scanner.scan(fakePng())).toEqual({ status: "ERROR" });
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe("storage outage", () => {
  const unreachableS3 = async () => {
    const endpoint = `http://127.0.0.1:${await closedPort()}`;
    return createS3Storage({
      bucket: "kproctor-outage-test",
      region: "us-east-1",
      endpoint,
      forcePathStyle: true,
      kmsKeyId: "alias/kproctor-test",
      client: new S3Client({
        region: "us-east-1",
        endpoint,
        forcePathStyle: true,
        maxAttempts: 1,
        credentials: { accessKeyId: "test", secretAccessKey: "test" },
      }),
    });
  };

  it("photo capture fails safely (503) and records nothing", async () => {
    const svc = createIdentityVerificationService(db, {
      storage: await unreachableS3(),
      scanner: clean,
    });
    const id = await attemptAtIdentity();
    await svc.start(id, candidate._id, ctx);
    await expectServiceUnavailable(svc.capturePhoto(id, candidate._id, fakeJpeg(), ctx));
    const v = await getCollections(db).identityVerifications.findOne({
      attemptId: new ObjectId(id),
    });
    expect(v!.photo).toBeNull();
  });

  it("document upload fails safely (503) after a clean scan and records nothing", async () => {
    const id = await attemptAtIdentity();
    const ok = createIdentityVerificationService(db, { scanner: clean });
    await ok.start(id, candidate._id, ctx);
    await ok.capturePhoto(id, candidate._id, fakeJpeg(), ctx);
    const broken = createIdentityVerificationService(db, {
      storage: await unreachableS3(),
      scanner: clean,
    });
    await expectServiceUnavailable(broken.uploadDocument(id, candidate._id, doc, ctx));
    const v = await getCollections(db).identityVerifications.findOne({
      attemptId: new ObjectId(id),
    });
    expect(v!.idDocument).toBeNull();
  });
});

describe("production safeguards", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    resetIdentityConfigForTests();
  });

  it("refuses development storage, a missing scanner and a missing KMS key", () => {
    process.env.NODE_ENV = "production";
    process.env.KPROCTOR_IDENTITY_STORAGE = "local";
    resetIdentityConfigForTests();
    expect(() => getIdentityConfig()).toThrow(/development-only/);

    Object.assign(process.env, {
      KPROCTOR_IDENTITY_STORAGE: "s3",
      KPROCTOR_S3_BUCKET: "b",
      KPROCTOR_S3_REGION: "r",
      KPROCTOR_MALWARE_SCANNER: "none",
    });
    resetIdentityConfigForTests();
    expect(() => getIdentityConfig()).toThrow(/required in production/);

    process.env.KPROCTOR_MALWARE_SCANNER = "clamav";
    delete process.env.KPROCTOR_S3_KMS_KEY_ID;
    resetIdentityConfigForTests();
    expect(() => getIdentityConfig()).toThrow(/KMS_KEY_ID/);
  });

  it("an unscanned document can't be used for verification in production", async () => {
    const id = await attemptAtIdentity();
    const dev = createIdentityVerificationService(db, { scanner: notConfiguredScanner });
    await dev.start(id, candidate._id, ctx);
    await dev.capturePhoto(id, candidate._id, fakeJpeg(), ctx);
    await dev.uploadDocument(id, candidate._id, doc, ctx); // SCAN_PENDING
    const prod = createIdentityVerificationService(db, {
      scanner: notConfiguredScanner,
      config: { ...getIdentityConfig(), production: true },
    });
    const error = await prod.verify(id, candidate._id, { consent: true }, ctx).catch((e) => e);
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).status).toBe(409);
    const v = await getCollections(db).identityVerifications.findOne({
      attemptId: new ObjectId(id),
    });
    expect(v!.status).toBe("DOCUMENT_UPLOADED");
  });
});

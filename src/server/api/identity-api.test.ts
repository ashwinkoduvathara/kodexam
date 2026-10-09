import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { IdentityStatusResponse, IdentityVerifyResponse } from "@/types/identity";
import { signCandidateToken } from "../auth/candidate-auth";
import { getCollections, USER_ROLE, type ExamDoc, type UserDoc } from "../db/collections";
import { closeMongoClient } from "../db/mongodb";
import { sha256Hex } from "../identity/crypto";
import { setMalwareScannerForTests, type MalwareScanner } from "../identity/malware-scanner";
import { getIdentityStorage } from "../identity/storage";
import { createIdentityVerificationService } from "../services/identity-verification-service";
import { ALL_PASSED, apiRequest, createCandidate, createExam, resetTestDb } from "../test/fixtures";
import {
  exeBytes,
  fakeJpeg,
  fakePdf,
  fakePng,
  htmlBytes,
  maliciousPdf,
  svgBytes,
} from "../test/identity-fixtures";
import { acknowledgeInstructions, startExamAttempt, submitSystemCheck } from "./exam-api";
import {
  captureIdentityPhoto,
  createIdentityAssetAccess,
  decideIdentityReview,
  deleteIdentityDocument,
  getIdentityReview,
  getIdentityStatus,
  retryIdentityVerification,
  serveIdentityObject,
  startIdentityVerification,
  uploadIdentityDocument,
  verifyIdentity,
} from "./identity-api";

let db: Db;
let candidate: UserDoc;
let exam: ExamDoc;

const base = (attemptId: string) => `/api/exam-attempts/${attemptId}/identity`;

function binaryRequest(
  path: string,
  who: UserDoc | null,
  body: Uint8Array,
  headers: Record<string, string> = {},
  method: "POST" | "DELETE" = "POST",
) {
  const h = new Headers({ host: "localhost:3100", "user-agent": "vitest-agent", ...headers });
  if (who) h.set("authorization", `Bearer ${signCandidateToken(who._id.toHexString())}`);
  return new Request(`http://localhost:3100${path}`, {
    method,
    headers: h,
    body: body as BodyInit,
  });
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Creates an attempt and walks it through Screens 1–2 to IDENTITY_VERIFICATION. */
async function attemptAtIdentity(who = candidate, onExam = exam): Promise<string> {
  const start = await json<{ attempt: { id: string } }>(
    await startExamAttempt(
      apiRequest(`/api/exams/${onExam._id}/attempts`, { method: "POST", candidate: who }),
      onExam._id.toHexString(),
    ),
  );
  const id = start.attempt.id;
  await submitSystemCheck(
    apiRequest(`/api/exam-attempts/${id}/system-check`, {
      method: "POST",
      candidate: who,
      body: { results: ALL_PASSED },
    }),
    id,
  );
  const ack = await acknowledgeInstructions(
    apiRequest(`/api/exam-attempts/${id}/instructions/acknowledge`, {
      method: "POST",
      candidate: who,
    }),
    id,
  );
  expect(ack.status).toBe(200);
  return id;
}

const start = (id: string, who = candidate) =>
  startIdentityVerification(
    apiRequest(`${base(id)}/start`, { method: "POST", candidate: who }),
    id,
  );
const capture = (id: string, who = candidate, bytes = fakeJpeg()) =>
  captureIdentityPhoto(
    binaryRequest(`${base(id)}/capture`, who, bytes, { "content-type": "image/jpeg" }),
    id,
  );
const upload = (
  id: string,
  bytes: Uint8Array = fakePng(),
  headers: Record<string, string> = {
    "content-type": "image/png",
    "x-file-extension": "png",
    "x-document-type": "AADHAAR",
  },
  who = candidate,
) =>
  uploadIdentityDocument(binaryRequest(`${base(id)}/document`, who, bytes, headers), id, {
    ipAddress: "203.0.113.9",
  });
const verify = (id: string, body: unknown = { consent: true }, who = candidate) =>
  verifyIdentity(apiRequest(`${base(id)}/verify`, { method: "POST", candidate: who, body }), id);
const status = (id: string, who: UserDoc | undefined = candidate) =>
  getIdentityStatus(apiRequest(`${base(id)}/status`, { candidate: who }), id);

async function readyForVerify(id: string) {
  expect((await start(id)).status).toBe(200);
  expect((await capture(id)).status).toBe(200);
  expect((await upload(id)).status).toBe(200);
}

async function makeReviewer(role: "proctor" | "admin", assignTo?: ExamDoc) {
  const reviewer = await createCandidate(db, {
    role: role === "admin" ? USER_ROLE.ADMIN : USER_ROLE.PROCTOR,
    name: "Reviewer",
  });
  if (assignTo) {
    await getCollections(db).exams.updateOne(
      { _id: assignTo._id },
      { $addToSet: { examinerIds: reviewer._id } },
    );
  }
  return reviewer;
}

beforeEach(async () => {
  db = await resetTestDb();
  candidate = await createCandidate(db, { name: "Asha Menon", rollNumber: "RN-555" });
  exam = await createExam(db);
});

afterEach(() => {
  setMalwareScannerForTests(null);
  vi.restoreAllMocks();
});

afterAll(async () => {
  await (await resetTestDb()).dropDatabase();
  await closeMongoClient();
});

describe("access control", () => {
  it("rejects unauthenticated requests", async () => {
    const id = await attemptAtIdentity();
    const res = await getIdentityStatus(apiRequest(`${base(id)}/status`), id);
    expect(res.status).toBe(401);
  });

  it("hides another candidate's attempt", async () => {
    const id = await attemptAtIdentity();
    const other = await createCandidate(db, { name: "Other" });
    for (const res of [await status(id, other), await start(id, other), await capture(id, other)]) {
      expect(res.status).toBe(404);
    }
  });

  it("requires the previous steps to be complete", async () => {
    const res0 = await startExamAttempt(
      apiRequest(`/api/exams/${exam._id}/attempts`, { method: "POST", candidate }),
      exam._id.toHexString(),
    );
    const id = (await json<{ attempt: { id: string } }>(res0)).attempt.id;
    expect((await start(id)).status).toBe(409);
  });

  it("does not let candidates use reviewer endpoints or view any document", async () => {
    const id = await attemptAtIdentity();
    await readyForVerify(id);
    const v = await getCollections(db).identityVerifications.findOne({});
    const res = await createIdentityAssetAccess(
      apiRequest(`/api/review/identity-verifications/${v!._id}/access`, {
        method: "POST",
        candidate,
        body: { asset: "document" },
      }),
      v!._id.toHexString(),
    );
    expect(res.status).toBe(403);
    expect(
      (await getIdentityReview(apiRequest(`/api/review/x`, { candidate }), v!._id.toHexString()))
        .status,
    ).toBe(403);
  });

  it("limits examiners to exams they are assigned to", async () => {
    const id = await attemptAtIdentity();
    await readyForVerify(id);
    const v = await getCollections(db).identityVerifications.findOne({});
    const outsider = await makeReviewer("proctor");
    const assigned = await makeReviewer("proctor", exam);
    const req = (who: UserDoc) =>
      getIdentityReview(
        apiRequest(`/api/review/identity-verifications/${v!._id}`, { candidate: who }),
        v!._id.toHexString(),
      );
    expect((await req(outsider)).status).toBe(404);
    expect((await req(assigned)).status).toBe(200);
  });
});

describe("state machine (server-controlled)", () => {
  it("walks NOT_STARTED → CAMERA_PENDING → PHOTO_CAPTURED → DOCUMENT_UPLOADED → PROCESSING → REVIEW_REQUIRED", async () => {
    const id = await attemptAtIdentity();
    expect((await json<IdentityStatusResponse>(await status(id))).status).toBe("NOT_STARTED");
    expect((await json<IdentityStatusResponse>(await start(id))).status).toBe("CAMERA_PENDING");
    expect((await json<IdentityStatusResponse>(await capture(id))).status).toBe("PHOTO_CAPTURED");
    expect((await json<IdentityStatusResponse>(await upload(id))).status).toBe("DOCUMENT_UPLOADED");
    const result = await json<IdentityVerifyResponse>(await verify(id));
    expect(result.identity.status).toBe("REVIEW_REQUIRED");
    // Default exam policy blocks until a reviewer decides.
    expect(result.identity.canProceed).toBe(false);
    expect(result.attemptStatus).toBe("IDENTITY_VERIFICATION");

    const events = (
      await getCollections(db).auditLogs.find({}).sort({ timestamp: 1, _id: 1 }).toArray()
    ).map((e) => e.eventType);
    expect(events).toEqual(
      expect.arrayContaining([
        "IDENTITY_VERIFICATION_STARTED",
        "CAMERA_CAPTURED",
        "DOCUMENT_UPLOADED",
        "IDENTITY_VERIFICATION_PROCESSING",
        "IDENTITY_REVIEW_REQUIRED",
      ]),
    );
  });

  it("refuses document upload before the photo", async () => {
    const id = await attemptAtIdentity();
    await start(id);
    expect((await upload(id)).status).toBe(409);
  });

  it("ignores client-supplied results: verified=true / faceMatch=true never verifies", async () => {
    const id = await attemptAtIdentity();
    await readyForVerify(id);
    const res = await verify(id, {
      consent: true,
      verified: true,
      faceMatch: true,
      status: "VERIFIED",
    });
    const body = await json<IdentityVerifyResponse>(res);
    expect(body.identity.status).toBe("REVIEW_REQUIRED");
    expect(body.identity.result?.faceMatch).toBeNull();
    const v = await getCollections(db).identityVerifications.findOne({});
    expect(v!.status).toBe("REVIEW_REQUIRED");
    expect(v!.verifiedAt).toBeNull();
  });

  it("requires explicit consent", async () => {
    const id = await attemptAtIdentity();
    await readyForVerify(id);
    expect((await verify(id, { verified: true })).status).toBe(422);
  });

  it("refuses an expired attempt and marks the verification EXPIRED", async () => {
    const id = await attemptAtIdentity();
    await readyForVerify(id);
    const c = getCollections(db);
    await c.examAttempts.updateOne({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await verify(id);
    expect(res.status).toBe(409);
    expect((await json<{ error: { code: string } }>(res)).error.code).toBe("ATTEMPT_EXPIRED");
    expect((await c.identityVerifications.findOne({}))!.status).toBe("EXPIRED");
    expect(await c.auditLogs.countDocuments({ eventType: "IDENTITY_VERIFICATION_EXPIRED" })).toBe(
      1,
    );
  });

  it("refuses a cancelled attempt", async () => {
    const id = await attemptAtIdentity();
    await readyForVerify(id);
    await getCollections(db).examAttempts.updateOne({}, { $set: { status: "CANCELLED" } });
    const res = await verify(id);
    expect(res.status).toBe(409);
  });

  it("handles concurrent verify requests: exactly one wins", async () => {
    const id = await attemptAtIdentity();
    await readyForVerify(id);
    const results = await Promise.all([verify(id), verify(id), verify(id), verify(id)]);
    const ok = results.filter((r) => r.status === 200);
    expect(ok).toHaveLength(1);
    for (const r of results) expect([200, 409]).toContain(r.status);
    const c = getCollections(db);
    expect(
      await c.auditLogs.countDocuments({ eventType: "IDENTITY_VERIFICATION_PROCESSING" }),
    ).toBe(1);
    expect((await c.identityVerifications.findOne({}))!.status).toBe("REVIEW_REQUIRED");
  });

  it("commits status and audit event atomically (audit failure rolls back the status)", async () => {
    const id = await attemptAtIdentity();
    await readyForVerify(id);
    // Make the PROCESSING audit insert fail inside the transaction.
    await db.command({
      collMod: "auditLogs",
      validator: { eventType: { $ne: "IDENTITY_VERIFICATION_PROCESSING" } },
      validationAction: "error",
    });
    try {
      const res = await verify(id);
      expect(res.status).toBe(500);
      const v = await getCollections(db).identityVerifications.findOne({});
      expect(v!.status).toBe("DOCUMENT_UPLOADED"); // rolled back — no state change without its audit event
    } finally {
      await db.command({ collMod: "auditLogs", validator: {}, validationLevel: "off" });
    }
  });
});

describe("document upload security", () => {
  async function atDocumentStep() {
    const id = await attemptAtIdentity();
    await start(id);
    await capture(id);
    return id;
  }

  it.each([
    ["executable renamed .pdf", exeBytes(), "application/pdf", "pdf"],
    ["HTML as .jpg", htmlBytes(), "image/jpeg", "jpg"],
    ["SVG", svgBytes(), "image/svg+xml", "svg"],
    ["PNG bytes spoofed as JPEG", fakePng(), "image/jpeg", "jpg"],
    ["JPEG with .png extension", fakeJpeg(), "image/jpeg", "png"],
  ])("rejects %s", async (_label, bytes, mime, ext) => {
    const id = await atDocumentStep();
    const res = await upload(id, bytes, {
      "content-type": mime,
      "x-file-extension": ext,
      "x-document-type": "PAN",
    });
    expect(res.status).toBe(415);
    expect((await getCollections(db).identityVerifications.findOne({}))!.idDocument).toBeNull();
  });

  it("rejects PDFs with active content", async () => {
    const id = await atDocumentStep();
    const res = await upload(id, maliciousPdf(), {
      "content-type": "application/pdf",
      "x-file-extension": "pdf",
      "x-document-type": "PAN",
    });
    expect(res.status).toBe(422);
  });

  it("rejects oversized files (declared and streamed)", async () => {
    const id = await atDocumentStep();
    const big = new Uint8Array(5 * 1024 * 1024 + 10);
    big.set(fakePng().subarray(0, 33));
    const res = await upload(id, big);
    expect(res.status).toBe(413);
    expect((await json<{ error: { code: string } }>(res)).error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("rejects an unknown document type", async () => {
    const id = await atDocumentStep();
    const res = await upload(id, fakePng(), {
      "content-type": "image/png",
      "x-file-extension": "png",
      "x-document-type": "LIBRARY_CARD",
    });
    expect(res.status).toBe(422);
  });

  it("stores a SHA-256 hash and an encrypted object; duplicate uploads are idempotent", async () => {
    const id = await atDocumentStep();
    const bytes = fakePng();
    await upload(id, bytes);
    const c = getCollections(db);
    const first = await c.identityVerifications.findOne({});
    expect(first!.idDocument!.documentHash).toBe(sha256Hex(bytes));
    expect(first!.idDocument!.scanStatus).toBe("SCAN_PENDING"); // no scanner configured — never "CLEAN"

    const again = await upload(id, bytes);
    expect(again.status).toBe(200);
    const second = await c.identityVerifications.findOne({});
    expect(second!.version).toBe(first!.version);
    expect(second!.idDocument!.documentReference).toBe(first!.idDocument!.documentReference);

    const meta = await getIdentityStorage().getMetadata(first!.idDocument!.documentReference);
    expect(meta?.encrypted).toBe(true);
  });

  it("handles a malware scan failure without storing the file", async () => {
    const id = await atDocumentStep();
    setMalwareScannerForTests({
      name: "test",
      scan: async () => ({ status: "ERROR" }),
    } satisfies MalwareScanner);
    const res = await upload(id);
    expect(res.status).toBe(503);
    const c = getCollections(db);
    expect((await c.identityVerifications.findOne({}))!.idDocument).toBeNull();
    expect(
      await c.auditLogs.countDocuments({
        eventType: "DOCUMENT_SCAN_COMPLETED",
        "metadata.result": "SCAN_FAILED",
      }),
    ).toBe(1);
  });

  it("rejects an infected file and never stores it", async () => {
    const id = await atDocumentStep();
    setMalwareScannerForTests({
      name: "test",
      scan: async () => ({ status: "INFECTED", signature: "Eicar-Test" }),
    });
    const res = await upload(id);
    expect(res.status).toBe(422);
    expect((await getCollections(db).identityVerifications.findOne({}))!.idDocument).toBeNull();
  });

  it("marks clean scans as CLEAN", async () => {
    const id = await atDocumentStep();
    setMalwareScannerForTests({ name: "test", scan: async () => ({ status: "CLEAN" }) });
    await upload(id);
    expect(
      (await getCollections(db).identityVerifications.findOne({}))!.idDocument!.scanStatus,
    ).toBe("CLEAN");
  });

  it("deletes the stored object when the candidate removes the document", async () => {
    const id = await atDocumentStep();
    await upload(id);
    const c = getCollections(db);
    const ref = (await c.identityVerifications.findOne({}))!.idDocument!.documentReference;
    const res = await deleteIdentityDocument(
      binaryRequest(`${base(id)}/document`, candidate, new Uint8Array(), {}, "DELETE"),
      id,
    );
    expect(res.status).toBe(200);
    expect(await getIdentityStorage().getMetadata(ref)).toBeNull();
    expect(await c.auditLogs.countDocuments({ eventType: "DOCUMENT_DELETED" })).toBe(1);
  });

  it("rate-limits uploads", async () => {
    const id = await atDocumentStep();
    const codes: number[] = [];
    for (let i = 0; i < 12; i++)
      codes.push(
        (
          await upload(id, htmlBytes(), {
            "content-type": "image/jpeg",
            "x-file-extension": "jpg",
            "x-document-type": "PAN",
          })
        ).status,
      );
    expect(codes).toContain(429);
  });
});

describe("data minimisation & confidentiality", () => {
  it("never returns references, hashes, URLs or file contents to the candidate", async () => {
    const id = await attemptAtIdentity();
    await start(id);
    await capture(id);
    const bodies = [
      await (await upload(id)).text(),
      await (await status(id)).text(),
      await (await verify(id)).text(),
    ];
    const v = await getCollections(db).identityVerifications.findOne({});
    for (const text of bodies) {
      expect(text).not.toContain(v!.idDocument!.documentReference);
      expect(text).not.toContain(v!.idDocument!.documentHash);
      expect(text).not.toContain(v!.photo!.reference);
      expect(text).not.toMatch(/identity-objects|https?:\/\//);
    }
  });

  it("never writes an ID number to logs, the database or storage in plaintext", async () => {
    const idNumber = "1234 5678 9012";
    const logs: string[] = [];
    for (const m of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
        logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      });
    }
    const id = await attemptAtIdentity();
    await start(id);
    await capture(id);
    await upload(id, fakePdf(`Aadhaar ${idNumber}`), {
      "content-type": "application/pdf",
      "x-file-extension": "pdf",
      "x-document-type": "AADHAAR",
    });
    await verify(id);

    expect(logs.join("\n")).not.toContain(idNumber);
    const c = getCollections(db);
    const dbText = JSON.stringify([
      await c.identityVerifications.find({}).toArray(),
      await c.auditLogs.find({}).toArray(),
    ]);
    expect(dbText).not.toContain(idNumber);

    // Encrypted at rest: the plaintext never appears in the stored files.
    const dir = process.env.KPROCTOR_IDENTITY_LOCAL_DIR!;
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else files.push(p);
      }
    };
    walk(dir);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(readFileSync(f).toString("latin1")).not.toContain(idNumber);
  });
});

describe("reviewer workflow", () => {
  async function pendingReview() {
    const id = await attemptAtIdentity();
    await readyForVerify(id);
    await verify(id);
    const v = await getCollections(db).identityVerifications.findOne({});
    return { id, v: v! };
  }

  it("issues a short-lived signed URL, audits the view, and the URL expires", async () => {
    const { v } = await pendingReview();
    const reviewer = await makeReviewer("proctor", exam);
    const res = await createIdentityAssetAccess(
      apiRequest(`/api/review/identity-verifications/${v._id}/access`, {
        method: "POST",
        candidate: reviewer,
        body: { asset: "document" },
      }),
      v._id.toHexString(),
    );
    expect(res.status).toBe(200);
    const { url, expiresAt } = await json<{ url: string; expiresAt: string }>(res);
    expect(new Date(expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(61_000);
    const token = url.split("/").pop()!;

    const served = await serveIdentityObject(new Request(`http://localhost:3100${url}`), token);
    expect(served.status).toBe(200);
    expect(served.headers.get("cache-control")).toContain("no-store");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(fakePng());
    expect(
      await getCollections(db).auditLogs.countDocuments({
        eventType: "DOCUMENT_VIEWED",
        actorType: "REVIEWER",
      }),
    ).toBe(1);

    // Tampered token → refused.
    const tampered = await serveIdentityObject(
      new Request("http://localhost/x"),
      `${token.slice(0, -2)}xx`,
    );
    expect(tampered.status).toBe(410);

    // Expired token → refused.
    const shortLived = await getIdentityStorage().getTemporaryAccess(
      v.idDocument!.documentReference,
      {
        ttlSeconds: 1,
        contentType: "image/png",
        sha256: v.idDocument!.documentHash,
      },
    );
    await new Promise((r) => setTimeout(r, 2100));
    const expired = await serveIdentityObject(
      new Request("http://localhost/x"),
      shortLived.url.split("/").pop()!,
    );
    expect(expired.status).toBe(410);
  });

  it("approval verifies the identity and advances the attempt", async () => {
    const { id, v } = await pendingReview();
    const reviewer = await makeReviewer("admin");
    const res = await decideIdentityReview(
      apiRequest(`/api/review/identity-verifications/${v._id}/decision`, {
        method: "POST",
        candidate: reviewer,
        body: { decision: "APPROVE", expectedVersion: v.version },
      }),
      v._id.toHexString(),
    );
    expect(res.status).toBe(200);
    const s = await json<IdentityStatusResponse>(await status(id));
    expect(s.status).toBe("VERIFIED");
    expect(s.canProceed).toBe(true);
    const attempt = await getCollections(db).examAttempts.findOne({});
    expect(attempt!.status).toBe("READY");
    expect(attempt!.identityVerification.status).toBe("VERIFIED");
  });

  it("prevents two reviewers overwriting each other (optimistic concurrency)", async () => {
    const { v } = await pendingReview();
    const a = await makeReviewer("admin");
    const b = await makeReviewer("admin");
    const decide = (who: UserDoc, decision: string) =>
      decideIdentityReview(
        apiRequest(`/api/review/identity-verifications/${v._id}/decision`, {
          method: "POST",
          candidate: who,
          body: { decision, expectedVersion: v.version },
        }),
        v._id.toHexString(),
      );
    const [r1, r2] = await Promise.all([decide(a, "APPROVE"), decide(b, "REJECT")]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const c = getCollections(db);
    expect(
      await c.auditLogs.countDocuments({
        actorType: "REVIEWER",
        eventType: { $in: ["IDENTITY_VERIFIED", "IDENTITY_FAILED"] },
      }),
    ).toBe(1);
  });

  it("lets the candidate proceed under review only when the exam policy allows it", async () => {
    const lenient = await createExam(db, {
      proctoringPolicy: { ...exam.proctoringPolicy, identityReviewPolicy: "ALLOW_PENDING_REVIEW" },
    });
    const id = await attemptAtIdentity(candidate, lenient);
    await readyForVerify(id);
    const body = await json<IdentityVerifyResponse>(await verify(id));
    expect(body.identity.status).toBe("REVIEW_REQUIRED");
    expect(body.identity.canProceed).toBe(true);
    expect(body.attemptStatus).toBe("READY");
  });

  it("rejection allows a limited retry that deletes previous evidence", async () => {
    const { id, v } = await pendingReview();
    const reviewer = await makeReviewer("admin");
    await decideIdentityReview(
      apiRequest(`/api/review/identity-verifications/${v._id}/decision`, {
        method: "POST",
        candidate: reviewer,
        body: { decision: "REJECT", expectedVersion: v.version },
      }),
      v._id.toHexString(),
    );
    const res = await retryIdentityVerification(
      apiRequest(`${base(id)}/retry`, { method: "POST", candidate }),
      id,
    );
    expect(res.status).toBe(200);
    expect((await json<IdentityStatusResponse>(res)).status).toBe("CAMERA_PENDING");
    expect(await getIdentityStorage().getMetadata(v.idDocument!.documentReference)).toBeNull();
    expect(await getIdentityStorage().getMetadata(v.photo!.reference)).toBeNull();
  });
});

describe("retention", () => {
  it("purges expired evidence and records the purge", async () => {
    const id = await attemptAtIdentity();
    await readyForVerify(id);
    const c = getCollections(db);
    const v = (await c.identityVerifications.findOne({}))!;
    const later = new Date(Date.now() + 365 * 24 * 3600 * 1000);
    const result = await createIdentityVerificationService(db, {
      clock: () => later,
    }).purgeExpired();
    expect(result.purged).toBe(1);
    expect(await getIdentityStorage().getMetadata(v.idDocument!.documentReference)).toBeNull();
    expect(await getIdentityStorage().getMetadata(v.photo!.reference)).toBeNull();
    const after = (await c.identityVerifications.findOne({}))!;
    expect(after.photo).toBeNull();
    expect(after.idDocument).toBeNull();
    expect(after.purgedAt).toBeInstanceOf(Date);
    expect(await c.auditLogs.countDocuments({ eventType: "IDENTITY_DATA_PURGED" })).toBe(1);
    expect(id).toBeTruthy();
  });
});

describe("audit records", () => {
  it("carry actor, server timestamp, IP and user agent — and no sensitive metadata", async () => {
    const id = await attemptAtIdentity();
    await readyForVerify(id);
    const upload = await getCollections(db).auditLogs.findOne({ eventType: "DOCUMENT_UPLOADED" });
    expect(upload).toMatchObject({
      actorType: "CANDIDATE",
      actorId: candidate._id,
      ipAddress: "203.0.113.9",
      userAgent: "vitest-agent",
    });
    expect(upload!.timestamp).toBeInstanceOf(Date);
    expect(upload!._id).toBeInstanceOf(ObjectId);
    expect(Object.keys(upload!.metadata).sort()).toEqual(
      [
        "documentType",
        "fileType",
        "fromStatus",
        "replacedPrevious",
        "scanStatus",
        "sizeBytes",
        "toStatus",
      ].sort(),
    );
  });
});

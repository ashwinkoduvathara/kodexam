/**
 * Screen 3 — Identity Verification, against the real API, MongoDB and storage.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ObjectId } from "mongodb";
import type { Page } from "puppeteer-core";
import { getCollections, USER_ROLE, type ExamDoc, type UserDoc } from "@/server/db/collections";
import { getDb } from "@/server/db/mongodb";
import { fakePng, htmlBytes } from "@/server/test/identity-fixtures";
import {
  api,
  assert,
  attemptAtIdentity,
  BASE,
  buttonState,
  createE2ECandidate,
  createE2EExam,
  createExaminer,
  db,
  mediaReport,
  openBrowser,
  OUT,
  test,
  wait,
  waitButton,
  waitText,
} from "./lib";

const VERIFY = "Verify & Continue";

function tempFile(name: string, bytes: Uint8Array) {
  const dir = join(OUT, "files");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
}

async function capturePhoto(page: Page) {
  await waitButton(page, "Capture Photo", true, 20000);
  await page.click("button ::-p-text(Capture Photo)");
  await waitText(page, "Photo captured", 10000);
}

async function uploadDocument(page: Page, file: string, type = "AADHAAR") {
  await page.select("#idv-document-type", type);
  const input = await page.$('input[type="file"]');
  await input!.uploadFile(file);
}

async function browserStorageSnapshot(page: Page) {
  return page.evaluate(async () => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
    indexedDb: (await indexedDB.databases?.())?.map((d) => d.name) ?? [],
    url: location.href,
  }));
}

export async function runIdentitySuite() {
  await test("S3-1 full flow: capture → upload → consent → review → approval → Start Exam", async () => {
    const exam = await createE2EExam();
    const user = await createE2ECandidate();
    const attemptId = await attemptAtIdentity(user, exam);
    const examiner = await createExaminer(exam);
    const { browser, page, errors } = await openBrowser({ user, path: `/exam/${exam._id}` });
    try {
      await page.waitForFunction(() => location.pathname.endsWith("/identity-verification"));
      await waitText(page, "Live Camera Verification");
      assert(
        (await buttonState(page, VERIFY))?.disabled,
        "Verify enabled before anything was done",
      );

      await capturePhoto(page);
      await uploadDocument(page, tempFile("id.png", fakePng()));
      await waitText(page, "security scan pending", 15000);
      assert((await buttonState(page, VERIFY))?.disabled, "Verify enabled before consent");
      await page.click('label[for="identity-consent"]');
      await waitButton(page, VERIFY, true);
      await page.screenshot({ path: `${OUT}/s3-ready-to-verify.png` });

      await page.click("button:not([disabled]) ::-p-text(Verify & Continue)");
      await waitText(page, "Manual review required", 15000);
      assert(
        !(await buttonState(page, "Continue to Start Exam")),
        "candidate could proceed before review",
      );
      await wait(500);
      const media = await mediaReport(page);
      assert(media.liveTracks === 0, "camera still running after submission");

      const c = await db();
      const v = await c.identityVerifications.findOne({ attemptId: new ObjectId(attemptId) });
      assert(v?.status === "REVIEW_REQUIRED", `status ${v?.status}`);
      assert(v.idDocument?.documentHash && v.photo?.sha256, "hashes missing");
      await page.screenshot({ path: `${OUT}/s3-review-required.png` });

      // Examiner views the evidence through a short-lived signed URL, then approves.
      const access = await api<{ url: string }>(
        examiner,
        "POST",
        `/api/review/identity-verifications/${v._id}/access`,
        { asset: "photo" },
      );
      assert(access.status === 200, `access ${access.status}`);
      const photo = await fetch(`${BASE}${access.data.url}`);
      assert(
        photo.status === 200 && photo.headers.get("cache-control")?.includes("no-store"),
        "signed photo access failed",
      );
      const decision = await api(
        examiner,
        "POST",
        `/api/review/identity-verifications/${v._id}/decision`,
        {
          decision: "APPROVE",
          expectedVersion: v.version,
        },
      );
      assert(decision.status === 200, `decision ${decision.status}`);

      await waitText(page, "Identity verified", 15000); // picked up by polling
      await page.click("button ::-p-text(Continue to Start Exam)");
      await page.waitForFunction(() => location.pathname.endsWith("/start"), { timeout: 10000 });
      await waitText(page, "ready to begin");
      const stepper = await page.$eval(
        'nav[aria-label="Exam progress"]',
        (n) => (n as HTMLElement).innerText,
      );
      assert(
        (stepper.match(/\(completed\)/g) ?? []).length === 3,
        "stepper doesn't show 3 completed steps",
      );

      const storage = await browserStorageSnapshot(page);
      assert(
        storage.local.length === 0 && storage.session.length === 0,
        `browser storage used: ${JSON.stringify(storage)}`,
      );
      assert(storage.indexedDb.length === 0, "IndexedDB used");
      assert(
        !/token|identity|photo|document|sha|ref/i.test(
          new URL(storage.url).pathname + new URL(storage.url).search,
        ),
        `identity data in URL: ${storage.url}`,
      );

      const events = (await c.auditLogs.find({ attemptId: new ObjectId(attemptId) }).toArray()).map(
        (e) => e.eventType,
      );
      for (const e of [
        "IDENTITY_VERIFICATION_STARTED",
        "CAMERA_CAPTURED",
        "DOCUMENT_UPLOADED",
        "IDENTITY_VERIFICATION_PROCESSING",
        "IDENTITY_REVIEW_REQUIRED",
        "PHOTO_VIEWED",
        "IDENTITY_VERIFIED",
      ]) {
        assert(events.includes(e as never), `missing audit event ${e}`);
      }
      assert(errors.length === 0, errors.join(" | "));
      return `REVIEW_REQUIRED → examiner APPROVE → VERIFIED → /start; ${events.length} audit events; no browser storage`;
    } finally {
      await browser.close();
    }
  });

  await test("S3-2 server rejects a disguised file and the UI explains it", async () => {
    const exam = await createE2EExam();
    const user = await createE2ECandidate();
    await attemptAtIdentity(user, exam);
    const { browser, page } = await openBrowser({
      user,
      path: `/exam/${exam._id}/identity-verification`,
    });
    try {
      await capturePhoto(page);
      await uploadDocument(page, tempFile("id.jpg", htmlBytes()), "PAN");
      await waitText(page, "This file type isn't supported", 10000);
      assert(
        !(
          await page.$eval('[data-section="document"]', (e) => (e as HTMLElement).innerText)
        ).includes("Uploaded ·"),
        "rejected file shown as uploaded",
      );
      return "HTML renamed .jpg → rejected server-side with a clear message";
    } finally {
      await browser.close();
    }
  });

  await test("S3-3 refresh keeps server state; Back shows instructions read-only", async () => {
    const exam = await createE2EExam();
    const user = await createE2ECandidate();
    await attemptAtIdentity(user, exam);
    const { browser, page } = await openBrowser({
      user,
      path: `/exam/${exam._id}/identity-verification`,
    });
    try {
      await capturePhoto(page);
      await uploadDocument(page, tempFile("id2.png", fakePng()));
      await waitText(page, "security scan pending", 15000);
      await page.reload({ waitUntil: "networkidle2" });
      await waitText(page, "Photo captured", 10000);
      await waitText(page, "security scan pending");

      await page.click("button ::-p-text(Back to Exam Instructions)");
      await page.waitForFunction(() => location.pathname.endsWith("/instructions"), {
        timeout: 5000,
      });
      await waitText(page, "Return to Identity Verification");
      const disabled = await page.$eval(
        "#instructions-acknowledgement",
        (e) => (e as HTMLButtonElement).disabled,
      );
      assert(disabled, "acknowledgement editable in read-only mode");
      await page.click("button ::-p-text(Return to Identity Verification)");
      await page.waitForFunction(() => location.pathname.endsWith("/identity-verification"), {
        timeout: 5000,
      });
      return "photo + document state restored from server; read-only revisit works";
    } finally {
      await browser.close();
    }
  });

  await test("S3-4 a tampered client can't verify itself", async () => {
    const exam = await createE2EExam();
    const user = await createE2ECandidate();
    const attemptId = await attemptAtIdentity(user, exam);
    const { browser, page } = await openBrowser({
      user,
      path: `/exam/${exam._id}/identity-verification`,
    });
    try {
      await waitText(page, "Live Camera Verification");
      const res = await page.evaluate(async (id) => {
        const r = await fetch(`/api/exam-attempts/${id}/identity/verify`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            consent: true,
            verified: true,
            faceMatch: true,
            status: "VERIFIED",
          }),
        });
        return r.status;
      }, attemptId);
      const v = await (
        await db()
      ).identityVerifications.findOne({ attemptId: new ObjectId(attemptId) });
      assert(res === 409 && v?.status !== "VERIFIED", `status ${res}, verification ${v?.status}`);
      return `forged "verified" request → ${res}; status stays ${v?.status}`;
    } finally {
      await browser.close();
    }
  });

  await test("S3-5 expired attempt can't continue identity verification", async () => {
    const exam = await createE2EExam();
    const user = await createE2ECandidate();
    const attemptId = await attemptAtIdentity(user, exam);
    await (
      await db()
    ).examAttempts.updateOne(
      { _id: new ObjectId(attemptId) },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    const { browser, page } = await openBrowser({
      user,
      path: `/exam/${exam._id}/identity-verification`,
    });
    try {
      await waitText(page, "Exam session has expired.", 10000);
      assert(!(await buttonState(page, VERIFY)), "Verify still offered");
      return "expired session shown, no verification controls";
    } finally {
      await browser.close();
    }
  });

  await test("S3-6 security headers", async () => {
    const res = await fetch(`${BASE}/`);
    const h = (n: string) => res.headers.get(n);
    assert(h("x-content-type-options") === "nosniff", "nosniff missing");
    assert(h("referrer-policy") === "no-referrer", "referrer-policy missing");
    assert(h("permissions-policy")?.includes("camera=(self)"), "permissions-policy missing");
    assert(h("x-frame-options") === "DENY", "x-frame-options missing");
    const api = await fetch(`${BASE}/api/network-test/ping`);
    assert(api.headers.get("x-content-type-options") === "nosniff", "API missing headers");
    const csp = h("content-security-policy");
    if (process.env.E2E_EXPECT_CSP === "true") {
      assert(csp?.includes("script-src 'self' 'nonce-"), `CSP missing: ${csp}`);
      const html = await res.text();
      const nonce = /'nonce-([^']+)'/.exec(csp!)?.[1];
      assert(nonce && html.includes(`nonce="${nonce}"`), "inline scripts not nonce-tagged");
    }
    return csp ? "baseline headers + nonce CSP" : "baseline headers (CSP is production-only)";
  });

  await test("S3-7 production client bundle contains no secrets", async () => {
    const dir = "dist/client";
    if (!existsSync(dir)) return "skipped (no build)";
    const secrets = [
      process.env.KPROCTOR_AUTH_SECRET,
      process.env.KPROCTOR_IDENTITY_MASTER_KEY,
      process.env.MONGODB_URI,
      "MongoClient",
      "KPROCTOR_IDENTITY_MASTER_KEY",
      "createCipheriv",
    ].filter(Boolean) as string[];
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else files.push(p);
      }
    };
    walk(dir);
    for (const f of files) {
      const text = readFileSync(f, "latin1");
      for (const s of secrets) assert(!text.includes(s), `${f} contains a secret/server marker`);
    }
    return `${files.length} client files scanned`;
  });
}

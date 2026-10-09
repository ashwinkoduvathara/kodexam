/**
 * Screen 2 — Exam Instructions. Each scenario runs against the real API and MongoDB.
 */
import type { HTTPRequest } from "puppeteer-core";
import { ObjectId } from "mongodb";
import {
  api,
  assert,
  attemptAtInstructions,
  buttonState,
  createE2ECandidate,
  createE2EExam,
  db,
  openBrowser,
  OUT,
  test,
  wait,
  waitButton,
  waitText,
} from "./lib";

const CONTINUE = "I Understand, Continue";

const checkboxState = (page: import("puppeteer-core").Page) =>
  page.$eval("#instructions-acknowledgement", (el) => el.getAttribute("data-state"));

export async function runInstructionsSuite() {
  await test("S2-1..3 session, exam and candidate render from MongoDB via the API", async () => {
    const exam = await createE2EExam();
    const user = await createE2ECandidate("Riya Thomas");
    await attemptAtInstructions(user, exam);
    const sessionCalls: number[] = [];
    const { browser, page, errors } = await openBrowser({ user, path: `/exam/${exam._id}` });
    try {
      page.on("response", (r) => {
        if (r.url().endsWith(`/api/exams/${exam._id}/session`)) sessionCalls.push(r.status());
      });
      await page.reload({ waitUntil: "networkidle2" });
      await waitText(page, "Exam Overview");
      assert(page.url().endsWith("/instructions"), `landed on ${page.url()}`);
      assert(sessionCalls.includes(200), "GET /api/exams/:id/session was not called");

      const stats = await page.$$eval("[data-stat]", (els) =>
        Object.fromEntries(els.map((e) => [e.getAttribute("data-stat"), e.textContent?.trim()])),
      );
      const expected = {
        Exam: exam.name,
        "Exam ID": exam.examCode,
        Duration: "75 Minutes",
        Questions: "42",
        "Total Marks": "120",
        "Passing Marks": "48",
        Attempt: "1 of 2",
      };
      for (const [k, v] of Object.entries(expected)) {
        assert(stats[k] === v, `${k}: expected "${v}", got "${stats[k]}"`);
      }
      const header = await page.$eval("header", (h) => (h as HTMLElement).innerText);
      assert(
        header.includes("Riya Thomas") && header.includes(user.rollNumber!),
        "candidate not shown",
      );
      assert(header.includes(exam.examCode), "exam code not in breadcrumb");
      const policy = await page.$$eval("[data-policy]", (els) =>
        els.map((e) => (e as HTMLElement).innerText.replace(/\s+/g, " ")),
      );
      assert(
        policy.join("|") ===
          "Camera Required|Microphone Required|Screen Monitoring Enabled|Fullscreen Required",
        `policy: ${policy}`,
      );
      assert(errors.length === 0, errors.join(" | "));
      await page.screenshot({ path: `${OUT}/s2-instructions-1440.png` });
      return `stats ${JSON.stringify(stats)}`;
    } finally {
      await browser.close();
    }
  });

  await test("S2-policy proctoring card follows each exam's policy", async () => {
    const exam = await createE2EExam({
      proctoringPolicy: {
        cameraRequired: true,
        microphoneRequired: false,
        screenMonitoringRequired: false,
        fullscreenRequired: false,
        identityVerificationRequired: true,
      },
    });
    const user = await createE2ECandidate();
    await attemptAtInstructions(user, exam);
    const { browser, page } = await openBrowser({ user, path: `/exam/${exam._id}/instructions` });
    try {
      await waitText(page, "Exam Overview");
      const policy = await page.$$eval("[data-policy]", (els) =>
        els.map((e) => (e as HTMLElement).innerText.replace(/\s+/g, " ")),
      );
      assert(
        policy.join("|") ===
          "Camera Required|Microphone Not Required|Screen Monitoring Disabled|Fullscreen Not Required",
        `policy: ${policy}`,
      );
      const flagged = await page.$eval(
        '[aria-labelledby="flagged-heading"]',
        (e) => (e as HTMLElement).innerText,
      );
      assert(
        !flagged.includes("Leaving fullscreen") && !flagged.includes("Screen sharing"),
        "irrelevant flags shown",
      );
      return policy.join(", ");
    } finally {
      await browser.close();
    }
  });

  await test("S2-4 pre-exam timer follows the server's expiresAt when the window closes first", async () => {
    const exam = await createE2EExam();
    const user = await createE2ECandidate();
    const attemptId = await attemptAtInstructions(user, exam);
    // The exam window now closes in 9.5 minutes — sooner than the duration. The header must
    // show the time the candidate would actually get, from the server deadline.
    const expiresAt = new Date(Date.now() + 570_000);
    await (
      await db()
    ).examAttempts.updateOne({ _id: new ObjectId(attemptId) }, { $set: { expiresAt } });
    const { browser, page } = await openBrowser({ user, path: `/exam/${exam._id}/instructions` });
    try {
      await waitText(page, "Exam Overview");
      const timer = await page.$eval('[role="timer"]', (e) => e.textContent ?? "");
      const tone = await page.$eval("[data-tone]", (e) => e.getAttribute("data-tone"));
      const [h, m, s] = timer.split(":").map(Number);
      const shown = h * 3600 + m * 60 + s;
      const actual = Math.ceil((expiresAt.getTime() - Date.now()) / 1000);
      assert(Math.abs(shown - actual) <= 3, `timer ${timer} vs server ${actual}s`);
      assert(tone === "warning", `tone ${tone}`);
      return `timer ${timer} (server says ${actual}s), tone ${tone}`;
    } finally {
      await browser.close();
    }
  });

  await test("S2-5..12,17 acknowledge → persisted, audited, navigates to Identity Verification", async () => {
    const exam = await createE2EExam();
    const user = await createE2ECandidate();
    const attemptId = await attemptAtInstructions(user, exam);
    const { browser, page } = await openBrowser({ user, path: `/exam/${exam._id}/instructions` });
    try {
      await waitText(page, "Exam Overview");
      assert((await checkboxState(page)) === "unchecked", "checkbox not initially unchecked");
      assert(
        (await buttonState(page, CONTINUE))?.disabled === true,
        "Continue enabled before acknowledgement",
      );

      // Keyboard: focus the checkbox and toggle with Space.
      await page.focus("#instructions-acknowledgement");
      await page.keyboard.press("Space");
      assert((await checkboxState(page)) === "checked", "Space did not check");
      await waitButton(page, CONTINUE, true);
      // Unchecking disables again; label click checks it.
      await page.keyboard.press("Space");
      await waitButton(page, CONTINUE, false);
      await page.click('label[for="instructions-acknowledgement"]');
      await waitButton(page, CONTINUE, true);

      const ackRequests: HTTPRequest[] = [];
      page.on("request", (r) => {
        if (r.url().includes(`/api/exam-attempts/${attemptId}/instructions/acknowledge`))
          ackRequests.push(r);
      });
      await page.click("button:not([disabled]) ::-p-text(I Understand, Continue)");
      await page.waitForFunction(() => location.pathname.endsWith("/identity-verification"), {
        timeout: 10000,
      });
      await waitText(page, "Live Camera Verification");
      assert(
        ackRequests.length === 1 && ackRequests[0].method() === "POST",
        "acknowledge API not called once",
      );

      const c = await db();
      const attempt = await c.examAttempts.findOne({ _id: new ObjectId(attemptId) });
      assert(attempt?.status === "IDENTITY_VERIFICATION", `status ${attempt?.status}`);
      assert(
        attempt.instructionsAcknowledgedAt instanceof Date,
        "instructionsAcknowledgedAt not stored",
      );
      const audit = await c.auditLogs.findOne({
        attemptId: attempt._id,
        eventType: "INSTRUCTIONS_ACKNOWLEDGED",
      });
      assert(audit, "audit event missing");
      assert(audit.candidateId?.equals(user._id), "audit candidate mismatch");
      assert(audit.userAgent?.includes("Chrome"), "audit userAgent missing");
      const stepper = await page.$eval(
        'nav[aria-label="Exam progress"]',
        (n) => (n as HTMLElement).innerText,
      );
      assert(
        (stepper.match(/\(completed\)/g) ?? []).length === 2,
        "stepper doesn't show 2 completed steps",
      );
      await page.screenshot({ path: `${OUT}/s2-identity-placeholder.png` });
      return `status=${attempt.status}, acknowledgedAt=${attempt.instructionsAcknowledgedAt.toISOString()}, audit ip=${audit.ipAddress}`;
    } finally {
      await browser.close();
    }
  });

  await test("S2-13 expired attempt cannot acknowledge (client + server)", async () => {
    const exam = await createE2EExam();
    const user = await createE2ECandidate();
    const attemptId = await attemptAtInstructions(user, exam);
    const { browser, page } = await openBrowser({ user, path: `/exam/${exam._id}/instructions` });
    try {
      await waitText(page, "Exam Overview");
      await page.click('label[for="instructions-acknowledgement"]');
      await waitButton(page, CONTINUE, true);
      // The server deadline passes while the page is open (client clock still says time left).
      const c = await db();
      await c.examAttempts.updateOne(
        { _id: new ObjectId(attemptId) },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      );
      await page.click("button:not([disabled]) ::-p-text(I Understand, Continue)");
      await waitText(page, "Exam session has expired.");
      await waitButton(page, CONTINUE, false);
      assert(page.url().endsWith("/instructions"), "navigated despite expiry");
      const attempt = await c.examAttempts.findOne({ _id: new ObjectId(attemptId) });
      assert(
        attempt?.status === "EXPIRED" && attempt.instructionsAcknowledgedAt === null,
        "attempt changed",
      );

      // After a refresh the server reports EXPIRED and the closed state is shown.
      await page.reload({ waitUntil: "networkidle2" });
      await waitText(page, "Exam session has expired.");
      assert(!(await buttonState(page, CONTINUE)), "Continue still offered after refresh");
      await page.screenshot({ path: `${OUT}/s2-expired.png` });
      return "server rejected with ATTEMPT_EXPIRED; UI shows expiry; Continue disabled";
    } finally {
      await browser.close();
    }
  });

  await test("S2-13b client timer reaching zero disables Continue", async () => {
    const exam = await createE2EExam();
    const user = await createE2ECandidate();
    const attemptId = await attemptAtInstructions(user, exam);
    await (
      await db()
    ).examAttempts.updateOne(
      { _id: new ObjectId(attemptId) },
      { $set: { expiresAt: new Date(Date.now() + 5000) } },
    );
    const { browser, page } = await openBrowser({ user, path: `/exam/${exam._id}/instructions` });
    try {
      await waitText(page, "Exam Overview");
      await waitText(page, "Exam session has expired.", 10000);
      assert(
        (await buttonState(page, CONTINUE))?.disabled === true,
        "Continue enabled after expiry",
      );
      return "expired notice shown at 00:00:00";
    } finally {
      await browser.close();
    }
  });

  await test("S2-14 another candidate cannot modify the attempt", async () => {
    const exam = await createE2EExam();
    const owner = await createE2ECandidate("Owner");
    const intruder = await createE2ECandidate("Intruder");
    const attemptId = await attemptAtInstructions(owner, exam);
    // The intruder is authenticated (own cookie) but targets the owner's attempt id.
    const { browser, page } = await openBrowser({ user: intruder, path: "/" });
    try {
      const result = await page.evaluate(async (id) => {
        const r = await fetch(`/api/exam-attempts/${id}/instructions/acknowledge`, {
          method: "POST",
        });
        return { status: r.status, body: await r.json() };
      }, attemptId);
      assert(result.status === 404, `status ${result.status}`);
      const read = await api(intruder, "GET", `/api/exam-attempts/${attemptId}`);
      assert(read.status === 404, `read status ${read.status}`);
      const attempt = await (await db()).examAttempts.findOne({ _id: new ObjectId(attemptId) });
      assert(
        attempt?.status === "INSTRUCTIONS" && !attempt.instructionsAcknowledgedAt,
        "attempt was modified",
      );
      return `acknowledge → ${result.status} ${result.body.error.code}; attempt unchanged`;
    } finally {
      await browser.close();
    }
  });

  await test("S2-15 refresh restores session and acknowledgement; timer stays frozen before the exam", async () => {
    const exam = await createE2EExam();
    const user = await createE2ECandidate();
    const attemptId = await attemptAtInstructions(user, exam);
    const { browser, page } = await openBrowser({ user, path: `/exam/${exam._id}/instructions` });
    try {
      await waitText(page, "Exam Overview");
      const t1 = await page.$eval('[role="timer"]', (e) => e.textContent);
      await wait(2200);
      await page.reload({ waitUntil: "networkidle2" });
      await waitText(page, "Exam Overview");
      const t2 = await page.$eval('[role="timer"]', (e) => e.textContent ?? "");
      // The exam timer doesn't run during setup: the 75-minute duration is shown, unchanged.
      assert(
        t1 === "75 Minutes" && t2 === "75 Minutes",
        `timer moved before the exam (${t1} → ${t2})`,
      );
      await page.waitForSelector('[role="timer"][data-running="false"]', { timeout: 10000 });
      assert(page.url().endsWith("/instructions"), "lost position on refresh");

      // Acknowledge, then refresh and try to go back to the instructions URL.
      await page.click('label[for="instructions-acknowledgement"]');
      await page.click("button:not([disabled]) ::-p-text(I Understand, Continue)");
      await page.waitForFunction(() => location.pathname.endsWith("/identity-verification"));
      await page.reload({ waitUntil: "networkidle2" });
      await waitText(page, "Live Camera Verification");
      await page.goto(page.url().replace("/identity-verification", "/instructions"), {
        waitUntil: "networkidle2",
      });
      await page.waitForFunction(() => location.pathname.endsWith("/identity-verification"), {
        timeout: 5000,
      });
      const attempt = await (await db()).examAttempts.findOne({ _id: new ObjectId(attemptId) });
      return `timer ${t1} → ${t2} across refresh; acknowledged state kept (status ${attempt?.status})`;
    } finally {
      await browser.close();
    }
  });

  await test("S2-16 Back returns to System Check", async () => {
    const exam = await createE2EExam();
    const user = await createE2ECandidate();
    await attemptAtInstructions(user, exam);
    const { browser, page } = await openBrowser({ user, path: `/exam/${exam._id}/instructions` });
    try {
      await waitText(page, "Exam Overview");
      await page.click("button ::-p-text(Back to System Check)");
      await page.waitForFunction(() => location.pathname.endsWith("/system-check"), {
        timeout: 5000,
      });
      await page.waitForSelector('[data-check="camera"]', { timeout: 10000 });
      return "System Check rendered with live checks";
    } finally {
      await browser.close();
    }
  });

  await test("S2-guards status-based routing and closed attempts", async () => {
    const exam = await createE2EExam();
    const user = await createE2ECandidate();
    // Attempt still at SYSTEM_CHECK → instructions visible but acknowledgement locked.
    const start = await api<{ attempt: { id: string } }>(
      user,
      "POST",
      `/api/exams/${exam._id}/attempts`,
      {},
    );
    const { browser, page } = await openBrowser({ user, path: `/exam/${exam._id}/instructions` });
    try {
      await waitText(page, "Complete the system check before continuing");
      const disabled = await page.$eval(
        "#instructions-acknowledgement",
        (e) => (e as HTMLButtonElement).disabled,
      );
      assert(disabled, "acknowledgement not locked before system check");
      // Identity placeholder can't be reached early.
      await page.goto(`${page.url().replace("/instructions", "/identity-verification")}`, {
        waitUntil: "networkidle2",
      });
      await page.waitForFunction(() => location.pathname.endsWith("/system-check"), {
        timeout: 5000,
      });
      // End the attempt → closed state everywhere.
      await api(user, "POST", `/api/exam-attempts/${start.data.attempt.id}/end`, {});
      await page.goto(page.url().replace("/system-check", "/instructions"), {
        waitUntil: "networkidle2",
      });
      await waitText(page, "This exam attempt has ended.");
      return "SYSTEM_CHECK locks acknowledgement; early identity URL redirected; CANCELLED shows closed state";
    } finally {
      await browser.close();
    }
  });

  await test("S2-auth unauthenticated visitor sees a safe error", async () => {
    const exam = await createE2EExam();
    const puppeteer = (await import("puppeteer-core")).default;
    const browser = await puppeteer.launch({
      executablePath:
        process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
    });
    try {
      const page = await browser.newPage();
      await page.goto(
        `${process.env.E2E_BASE_URL ?? "http://localhost:3100"}/exam/${exam._id}/instructions`,
        {
          waitUntil: "networkidle2",
        },
      );
      await waitText(page, "We couldn't verify your exam session.");
      const html = await page.content();
      assert(
        !/mongodb:\/\//i.test(html) && !html.includes("KPROCTOR_AUTH_SECRET"),
        "secret leaked",
      );
      return "no session cookie → verification error, no data";
    } finally {
      await browser.close();
    }
  });

  await test("S2-17 exam timer starts only when the exam starts, not during setup", async () => {
    const exam = await createE2EExam({
      proctoringPolicy: {
        cameraRequired: true,
        microphoneRequired: true,
        screenMonitoringRequired: true,
        fullscreenRequired: true,
        identityVerificationRequired: false,
      },
    });
    const user = await createE2ECandidate();
    const attemptId = await attemptAtInstructions(user, exam);
    const ack = await api(
      user,
      "POST",
      `/api/exam-attempts/${attemptId}/instructions/acknowledge`,
      {},
    );
    assert(ack.status === 200, `acknowledge → ${ack.status}`);
    // Simulate a candidate who spent 40 minutes on setup.
    await (
      await db()
    ).examAttempts.updateOne(
      { _id: new ObjectId(attemptId) },
      { $set: { startedAt: new Date(Date.now() - 40 * 60_000) } },
    );
    const { browser, page } = await openBrowser({ user, path: `/exam/${exam._id}/start` });
    const timer = () => page.$eval('[role="timer"]', (e) => e.textContent ?? "");
    try {
      await page.waitForSelector('[role="timer"][data-running="false"]', { timeout: 10000 });
      const before = await timer();
      assert(before === "75 Minutes", `before start: ${before}`);

      const started = await api<{ attempt: { status: string; examStartedAt: string } }>(
        user,
        "POST",
        `/api/exam-attempts/${attemptId}/start-exam`,
        {},
      );
      assert(started.status === 200, `start-exam → ${started.status}`);
      assert(started.data.attempt.status === "IN_PROGRESS", started.data.attempt.status);

      await page.reload({ waitUntil: "networkidle2" });
      await page.waitForSelector('[role="timer"][data-running="true"]', { timeout: 10000 });
      const t1 = await timer();
      await wait(2200);
      const t2 = await timer();
      const toSec = (t: string) =>
        t
          .split(":")
          .map(Number)
          .reduce((a, n) => a * 60 + n, 0);
      // Full 75 minutes from the start moment, despite 40 minutes of setup — and now counting down.
      assert(toSec(t1) >= 75 * 60 - 10 && toSec(t1) <= 75 * 60, `after start: ${t1}`);
      assert(toSec(t1) - toSec(t2) >= 1, `timer not running (${t1} → ${t2})`);
      return `setup: ${before} frozen → started: ${t1} → ${t2}`;
    } finally {
      await browser.close();
    }
  });
}

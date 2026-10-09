/**
 * Screen 4 — Start Exam, against the real API and MongoDB.
 */
import { ObjectId } from "mongodb";
import type { HTTPRequest, Page } from "puppeteer-core";
import {
  api,
  assert,
  attemptAtStart,
  buttonState,
  createE2ECandidate,
  createE2EExam,
  db,
  mediaReport,
  openBrowser,
  OUT,
  test,
  wait,
  waitButton,
  waitText,
} from "./lib";

const START = "Start Exam";
const READY_TEXT = "ready to begin";

const isStartRequest = (r: HTTPRequest) => r.method() === "POST" && r.url().includes("/start-exam");

const timerText = (page: Page) => page.$eval('[role="timer"]', (e) => e.textContent ?? "");
const toSec = (t: string) =>
  t
    .split(":")
    .map(Number)
    .reduce((a, n) => a * 60 + n, 0);

async function acknowledge(page: Page) {
  await page.click('label[for="start-acknowledgement"]');
  await waitButton(page, START, true);
}

/** A candidate whose attempt is READY (identity approved by an examiner), on Screen 4. */
async function readyCandidate(examOverrides = {}) {
  const exam = await createE2EExam(examOverrides);
  const user = await createE2ECandidate();
  const attemptId = await attemptAtStart(user, exam);
  return { exam, user, attemptId };
}

export async function runStartSuite() {
  await test("S4-1..3 exam details, stepper, policy and status all come from the server", async () => {
    const { exam, user } = await readyCandidate({
      name: "Operating Systems",
      durationMinutes: 45,
      totalQuestions: 33,
      totalMarks: 77,
      passingMarks: 31,
      attemptLimit: 3,
      proctoringPolicy: {
        cameraRequired: true,
        microphoneRequired: false,
        screenMonitoringRequired: false,
        fullscreenRequired: true,
        identityVerificationRequired: true,
      },
    });
    const { browser, page, errors } = await openBrowser({
      user,
      path: `/exam/${exam._id}`,
      width: 1536,
      height: 1024,
    });
    try {
      await page.waitForFunction(() => location.pathname.endsWith("/start"), { timeout: 10000 });
      await waitText(page, READY_TEXT);
      const stats = await page.$$eval("[data-stat]", (els) =>
        Object.fromEntries(els.map((e) => [e.getAttribute("data-stat"), e.textContent])),
      );
      const expected = {
        Exam: "Operating Systems",
        "Exam ID": exam.examCode,
        Duration: "45 Minutes",
        Questions: "33",
        "Total Marks": "77",
        "Passing Marks": "31",
        Attempt: "1 of 3",
      };
      for (const [k, v] of Object.entries(expected)) {
        assert(stats[k] === v, `${k}: ${stats[k]} ≠ ${v}`);
      }
      const policy = await page.$$eval("[data-policy]", (els) =>
        Object.fromEntries(els.map((e) => [e.getAttribute("data-policy"), e.textContent])),
      );
      assert(policy.camera?.includes("Required"), `camera ${policy.camera}`);
      assert(policy.microphone?.includes("Not Required"), `mic ${policy.microphone}`);
      assert(policy.screen?.includes("Disabled"), `screen ${policy.screen}`);
      assert(policy.fullscreen?.endsWith("Required"), `fullscreen ${policy.fullscreen}`);

      const steps = await page.$$eval('nav[aria-label="Exam progress"] li', (els) =>
        els.map((e) => e.textContent ?? ""),
      );
      assert(steps.length === 4, `${steps.length} steps`);
      steps.slice(0, 3).forEach((s, i) => assert(s.includes("(completed)"), `step ${i + 1}: ${s}`));
      assert(steps[3].includes("(current step)"), `step 4: ${steps[3]}`);

      const status = await page.$eval("[data-ready-status]", (e) =>
        e.getAttribute("data-ready-status"),
      );
      assert(status === "success", `status card ${status}`);
      await waitText(page, "All checks complete");

      const timer = await timerText(page);
      const running = await page.$eval('[role="timer"]', (e) => e.getAttribute("data-running"));
      assert(timer === "45 Minutes" && running === "false", `header ${timer} running=${running}`);
      assert(errors.length === 0, errors.join("; "));
      await page.screenshot({ path: `${OUT}/s4-start-1536.png`, fullPage: true });
      return `stats ${Object.values(stats).join(" · ")}; steps 1–3 complete, 4 current; header ${timer}`;
    } finally {
      await browser.close();
    }
  });

  await test("S4-4..6 acknowledgement starts unchecked, gates Start, works by keyboard", async () => {
    const { exam, user } = await readyCandidate();
    const { browser, page } = await openBrowser({ user, path: `/exam/${exam._id}/start` });
    try {
      await waitText(page, READY_TEXT);
      const state = await page.$eval("#start-acknowledgement", (e) => e.getAttribute("data-state"));
      assert(state === "unchecked", `checkbox ${state}`);
      assert((await buttonState(page, START))?.disabled, "Start enabled before acknowledgement");
      await page.focus("#start-acknowledgement");
      await page.keyboard.press("Space");
      await waitButton(page, START, true);
      await page.keyboard.press("Space");
      await waitButton(page, START, false);
      return "unchecked → Start disabled; Space toggles it on and off";
    } finally {
      await browser.close();
    }
  });

  await test("S4-10..13,15 start: server-confirmed, single request, server deadline, audited", async () => {
    const { exam, user, attemptId } = await readyCandidate({ durationMinutes: 45 });
    const { browser, page, errors } = await openBrowser({ user, path: `/exam/${exam._id}/start` });
    try {
      await waitText(page, READY_TEXT);
      await acknowledge(page);
      let requests = 0;
      await page.setRequestInterception(true);
      page.on("request", (r) => {
        if (!isStartRequest(r)) return void r.continue();
        requests += 1;
        setTimeout(() => void r.continue(), 1500); // slow server: the UI must wait for it
      });
      const before = Date.now();
      await page.click(`button ::-p-text(${START})`);
      await page.click(`button ::-p-text(Starting)`).catch(() => undefined); // a second click
      await waitText(page, "Starting Exam");
      await wait(500);
      assert(page.url().endsWith("/start"), "navigated before the server confirmed");
      await page.waitForFunction(() => location.pathname.endsWith("/active"), { timeout: 10000 });
      await waitText(page, "Live Camera Feed");
      await page.waitForSelector('[role="timer"][data-running="true"]');

      const c = await db();
      const attempt = await c.examAttempts.findOne({ _id: new ObjectId(attemptId) });
      assert(attempt?.status === "IN_PROGRESS", `status ${attempt?.status}`);
      const startedAt = attempt.examStartedAt!.getTime();
      assert(startedAt >= before - 2000 && startedAt <= Date.now(), "start time not server time");
      assert(
        attempt.expiresAt.getTime() === startedAt + 45 * 60_000,
        "deadline not server-derived",
      );
      const audits = await c.auditLogs.countDocuments({
        attemptId: attempt._id,
        eventType: "EXAM_STARTED",
      });
      assert(requests === 1, `${requests} start requests`);
      assert(audits === 1, `${audits} EXAM_STARTED events`);
      const shown = toSec(await timerText(page));
      const actual = Math.ceil((attempt.expiresAt.getTime() - Date.now()) / 1000);
      assert(Math.abs(shown - actual) <= 3, `timer ${shown}s vs server ${actual}s`);
      assert(errors.length === 0, errors.join("; "));
      await page.screenshot({ path: `${OUT}/s4-active.png` });
      return `1 request, navigated after confirmation; deadline = start + 45 min; 1 audit event`;
    } finally {
      await browser.close();
    }
  });

  await test("S4-16 refresh keeps the deadline; preparation URLs go to the running exam", async () => {
    const { exam, user, attemptId } = await readyCandidate();
    const started = await api<{ attempt: { expiresAt: string } }>(
      user,
      "POST",
      `/api/exam-attempts/${attemptId}/start-exam`,
      {},
    );
    assert(started.status === 200, `start → ${started.status}`);
    const { browser, page } = await openBrowser({ user, path: `/exam/${exam._id}/start` });
    try {
      await page.waitForFunction(() => location.pathname.endsWith("/active"), { timeout: 10000 });
      const t1 = toSec(await timerText(page));
      await wait(2200);
      await page.reload({ waitUntil: "networkidle2" });
      await page.waitForSelector('[role="timer"][data-running="true"]');
      const t2 = toSec(await timerText(page));
      assert(t1 - t2 >= 1 && t1 - t2 <= 5, `timer reset on refresh (${t1} → ${t2})`);
      for (const step of ["system-check", "instructions", "identity-verification", "start"]) {
        await page.goto(page.url().replace(/\/active.*$/, `/${step}`), {
          waitUntil: "networkidle2",
        });
        await page.waitForFunction(() => location.pathname.endsWith("/active"), { timeout: 8000 });
      }
      const attempt = await (await db()).examAttempts.findOne({ _id: new ObjectId(attemptId) });
      assert(
        attempt?.expiresAt.toISOString() === started.data.attempt.expiresAt,
        "deadline changed",
      );
      return `timer ${t1}s → ${t2}s across refresh; all preparation URLs redirect to /active`;
    } finally {
      await browser.close();
    }
  });

  await test("S4-14 a failed start shows an error, no false success, and can be retried", async () => {
    const { exam, user, attemptId } = await readyCandidate();
    const { browser, page } = await openBrowser({ user, path: `/exam/${exam._id}/start` });
    try {
      await waitText(page, READY_TEXT);
      await acknowledge(page);
      let fail = true;
      await page.setRequestInterception(true);
      page.on("request", (r) => {
        if (isStartRequest(r) && fail) return void r.abort("failed");
        void r.continue();
      });
      await page.click(`button ::-p-text(${START})`);
      await waitText(page, "couldn't confirm that your exam started");
      assert(page.url().endsWith("/start"), "navigated after a failed start");
      assert(!(await page.$("::-p-text(Live Camera Feed)")), "false success shown");
      const attempt = await (await db()).examAttempts.findOne({ _id: new ObjectId(attemptId) });
      assert(attempt?.status === "READY", `status ${attempt?.status}`);

      fail = false;
      await waitButton(page, START, true);
      await page.click(`button ::-p-text(${START})`);
      await page.waitForFunction(() => location.pathname.endsWith("/active"), { timeout: 10000 });
      return "network failure → error, still READY; retry → started";
    } finally {
      await browser.close();
    }
  });

  await test("S4-lost server started the exam but the response was lost → moves on", async () => {
    const { exam, user, attemptId } = await readyCandidate();
    const { browser, page } = await openBrowser({ user, path: `/exam/${exam._id}/start` });
    try {
      await waitText(page, READY_TEXT);
      await acknowledge(page);
      await page.setRequestInterception(true);
      page.on("request", async (r) => {
        if (!isStartRequest(r)) return void r.continue();
        // The server processes the start, but the browser never sees the response.
        await api(user, "POST", `/api/exam-attempts/${attemptId}/start-exam`, {});
        void r.abort("failed");
      });
      await page.click(`button ::-p-text(${START})`);
      await page.waitForFunction(() => location.pathname.endsWith("/active"), { timeout: 10000 });
      await waitText(page, "Live Camera Feed");
      return "reconciled with the server session → /active";
    } finally {
      await browser.close();
    }
  });

  await test("S4-12 concurrent start requests start the exam once", async () => {
    const { user, attemptId } = await readyCandidate();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        api<{ attempt: { expiresAt: string } }>(
          user,
          "POST",
          `/api/exam-attempts/${attemptId}/start-exam`,
          {},
        ),
      ),
    );
    const deadlines = new Set(results.map((r) => r.data.attempt?.expiresAt));
    assert(
      results.every((r) => r.status === 200),
      results.map((r) => r.status).join(","),
    );
    assert(deadlines.size === 1, `${deadlines.size} different deadlines`);
    const audits = await (
      await db()
    ).auditLogs.countDocuments({ attemptId: new ObjectId(attemptId), eventType: "EXAM_STARTED" });
    assert(audits === 1, `${audits} audit events`);
    return "5 concurrent → 1 start, 1 deadline, 1 audit event";
  });

  await test("S4-7..9 ownership and identity policy are enforced on the server", async () => {
    // BLOCK policy, identity still under review → not READY; Screen 4 redirects to Screen 3.
    const exam = await createE2EExam();
    const user = await createE2ECandidate();
    const attemptId = await attemptAtStart(user, exam, { approve: false });
    const refused = await api<{ error: { code: string } }>(
      user,
      "POST",
      `/api/exam-attempts/${attemptId}/start-exam`,
      {},
    );
    assert(refused.status === 409, `pending review → ${refused.status}`);
    const intruder = await createE2ECandidate("Someone Else");
    const ready = await readyCandidate();
    const stolen = await api(
      intruder,
      "POST",
      `/api/exam-attempts/${ready.attemptId}/start-exam`,
      {},
    );
    assert(stolen.status === 404, `another candidate → ${stolen.status}`);

    const { browser, page } = await openBrowser({ user, path: `/exam/${exam._id}/start` });
    try {
      await page.waitForFunction(() => location.pathname.endsWith("/identity-verification"), {
        timeout: 10000,
      });
    } finally {
      await browser.close();
    }

    // ALLOW_PENDING_REVIEW: may start, but the page doesn't claim "All checks complete".
    const lenient = await createE2EExam({
      proctoringPolicy: {
        cameraRequired: true,
        microphoneRequired: true,
        screenMonitoringRequired: true,
        fullscreenRequired: true,
        identityVerificationRequired: true,
        identityReviewPolicy: "ALLOW_PENDING_REVIEW",
      },
    });
    const user2 = await createE2ECandidate();
    await attemptAtStart(user2, lenient, { approve: false });
    const s2 = await openBrowser({ user: user2, path: `/exam/${lenient._id}/start` });
    try {
      await waitText(s2.page, "identity under review");
      const status = await s2.page.$eval("[data-ready-status]", (e) =>
        e.getAttribute("data-ready-status"),
      );
      assert(status === "info", `status card ${status}`);
      assert(!(await s2.page.$("::-p-text(All checks complete)")), "claimed all checks complete");
      await acknowledge(s2.page);
    } finally {
      await s2.browser.close();
    }
    return "BLOCK + review → 409 and redirected to Screen 3; other candidate → 404; ALLOW_PENDING → startable, honest status";
  });

  await test("S4-17 Back returns to Screen 3 (read-only, camera off) and forward again", async () => {
    const { exam, user } = await readyCandidate();
    const { browser, page } = await openBrowser({ user, path: `/exam/${exam._id}/start` });
    try {
      await waitText(page, READY_TEXT);
      await page.click("button ::-p-text(Back to Identity Verification)");
      await page.waitForFunction(() => location.pathname.endsWith("/identity-verification"));
      await waitText(page, "Continue to Start Exam");
      await wait(800);
      const media = await mediaReport(page);
      assert(media.liveTracks === 0, "camera started on a read-only revisit");
      await page.click("button ::-p-text(Continue to Start Exam)");
      await page.waitForFunction(() => location.pathname.endsWith("/start"));
      await waitText(page, READY_TEXT);
      return "Screen 4 → Screen 3 (verified, no camera) → Screen 4";
    } finally {
      await browser.close();
    }
  });

  await test("S4-layout no horizontal scroll at the target desktop sizes", async () => {
    const { exam, user } = await readyCandidate();
    const sizes: [number, number][] = [
      [1536, 1024],
      [1440, 900],
      [1280, 800],
      [1920, 1080],
    ];
    const out: string[] = [];
    for (const [width, height] of sizes) {
      const { browser, page } = await openBrowser({
        user,
        path: `/exam/${exam._id}/start`,
        width,
        height,
      });
      try {
        await waitText(page, READY_TEXT);
        const { scroll, footerBottom } = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth - window.innerWidth,
          footerBottom:
            [...document.querySelectorAll("button")]
              .find((b) => b.textContent?.includes("Start Exam"))
              ?.getBoundingClientRect().bottom ?? 0,
        }));
        assert(scroll <= 0, `${width}×${height}: horizontal overflow ${scroll}px`);
        await page.screenshot({ path: `${OUT}/s4-start-${width}x${height}.png` });
        out.push(
          `${width}×${height}${footerBottom > height ? ` (Start ${Math.round(footerBottom - height)}px below fold)` : ""}`,
        );
      } finally {
        await browser.close();
      }
    }
    return out.join(", ");
  });
}

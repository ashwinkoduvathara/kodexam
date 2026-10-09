/**
 * Active exam screen — questions, answers, camera, proctoring events, timeout
 * and submission, against the real API and MongoDB with Chrome's fake devices.
 */
import { ObjectId } from "mongodb";
import type { HTTPRequest, Page } from "puppeteer-core";
import type { ExamDoc, UserDoc } from "@/server/db/collections";
import {
  api,
  assert,
  attemptAtIdentity,
  attemptRunning,
  createE2ECandidate,
  createE2EExam,
  createE2EQuestions,
  db,
  mediaReport,
  openBrowser,
  OUT,
  test,
  wait,
  waitText,
} from "./lib";

const NO_IDENTITY = {
  cameraRequired: true,
  microphoneRequired: true,
  screenMonitoringRequired: true,
  fullscreenRequired: true,
  identityVerificationRequired: false,
};

/** A candidate whose exam (12 questions in two sections) is running. */
async function running(overrides: Partial<ExamDoc> = {}, count = 12) {
  const exam = await createE2EExam({
    sections: [
      { id: "A", title: "Section A" },
      { id: "B", title: "Section B" },
    ],
    proctoringPolicy: NO_IDENTITY,
    ...overrides,
  });
  const questions = await createE2EQuestions(exam, count, ["A", "B"]);
  const user = await createE2ECandidate();
  const attemptId = await attemptRunning(user, exam);
  return { exam, user, attemptId, questions };
}

const open = (user: UserDoc, exam: ExamDoc, q = 1, size?: { width: number; height: number }) =>
  openBrowser({ user, path: `/exam/${exam._id}/active?q=${q}`, ...size });

const ready = (page: Page) =>
  page.waitForSelector('[role="radiogroup"]', { timeout: 15000 }).then(() => undefined);

const pathQ = (page: Page) => new URL(page.url()).searchParams.get("q");
const option = (page: Page, letter: string) => `[data-option="${letter}"]`;
const checked = (page: Page, letter: string) =>
  page.$eval(option(page, letter), (e) => e.getAttribute("aria-checked"));
const cellStatus = (page: Page, n: number) =>
  page.$eval(`[data-question-cell="${n}"]`, (e) => e.getAttribute("data-status"));
const statusItem = (page: Page, id: string) =>
  page.$eval(`[data-status-item="${id}"]`, (e) => ({
    tone: e.getAttribute("data-tone"),
    text: e.textContent ?? "",
  }));
const answerDoc = async (attemptId: string, questionId: ObjectId) =>
  (await db()).candidateAnswers.findOne({ attemptId: new ObjectId(attemptId), questionId });

const isAnswerWrite = (r: HTTPRequest) =>
  r.method() === "POST" &&
  r.url().includes("/answers/") &&
  (r.postData() ?? "").includes("selectedOptionId");

export async function runActiveSuite() {
  await test("A1 active attempt loads from the server: header, questions, camera, status", async () => {
    const { exam, user, attemptId } = await running();
    const { browser, page, errors } = await openBrowser({
      user,
      path: `/exam/${exam._id}`,
      width: 1536,
      height: 1024,
    });
    try {
      await page.waitForFunction(() => location.pathname.endsWith("/active"), { timeout: 10000 });
      await ready(page);
      await waitText(page, `Exam ID: ${exam.examCode}`);
      await waitText(page, "Test question 1?");
      const position = await page.$eval("main", (e) => e.textContent ?? "");
      assert(/Question\s*1\s*of\s*12/.test(position), "question position missing");
      const cells = await page.$$("[data-question-cell]");
      assert(cells.length === 12, `${cells.length} navigator cells`);
      await page.waitForSelector("[data-camera-live]", { timeout: 15000 });
      const cam = await statusItem(page, "camera");
      const mic = await statusItem(page, "microphone");
      const screen = await statusItem(page, "screen");
      assert(cam.tone === "ok" && cam.text.includes("ON"), `camera ${cam.text}`);
      assert(mic.tone === "ok" && mic.text.includes("ON"), `mic ${mic.text}`);
      assert(screen.text.includes("Unavailable"), `screen monitoring ${screen.text}`);
      await page.waitForSelector('[data-face-detection="unavailable"]');
      await page.waitForSelector('[role="timer"][data-running="true"]');
      const attempt = await (await db()).examAttempts.findOne({ _id: new ObjectId(attemptId) });
      const shown = (await page.$eval('[role="timer"]', (e) => e.textContent ?? ""))
        .split(":")
        .map(Number)
        .reduce((a, n) => a * 60 + n, 0);
      const actual = Math.ceil((attempt!.expiresAt.getTime() - Date.now()) / 1000);
      assert(Math.abs(shown - actual) <= 3, `timer ${shown}s vs server ${actual}s`);
      await wait(1500);
      assert((await cellStatus(page, 1)) === "not_answered", "visit not recorded");
      assert(errors.length === 0, errors.join("; "));
      await page.screenshot({ path: `${OUT}/a1-active-1536.png` });
      return `12 questions, camera LIVE, mic ON, screen monitoring honestly Unavailable, timer ±${Math.abs(shown - actual)}s`;
    } finally {
      await browser.close();
    }
  });

  await test("A2 correct answers never reach the browser", async () => {
    const { exam, user } = await running();
    const { browser, page } = await open(user, exam);
    try {
      const paper = page.waitForResponse((r) => r.url().endsWith("/paper"));
      await page.reload();
      const body = await (await paper).text();
      assert(!/correct|topic|difficulty/i.test(body), "paper exposes answer metadata");
      const pageSource = await page.content();
      assert(!/correctOptionIds/.test(pageSource), "page exposes answer metadata");
      return `paper response (${body.length} bytes) has no correct-answer fields`;
    } finally {
      await browser.close();
    }
  });

  await test("A3 select → Save & Next persists; review persists; refresh keeps answers and timer", async () => {
    const { exam, user, attemptId, questions } = await running();
    const { browser, page } = await open(user, exam);
    try {
      await ready(page);
      await page.click(option(page, "C"));
      await page.waitForSelector('[data-save-status="unsaved"]');
      await page.click("button ::-p-text(Save & Next)");
      await page.waitForFunction(() => new URL(location.href).searchParams.get("q") === "2");
      const a1 = await answerDoc(attemptId, questions[0]._id);
      assert(a1?.selectedOptionIds[0] === "c", `saved ${a1?.selectedOptionIds}`);
      assert((await cellStatus(page, 1)) === "answered", "navigator not updated");

      await page.click('[role="switch"]');
      await page.waitForFunction(
        () => document.querySelector('[role="switch"]')?.getAttribute("aria-checked") === "true",
      );
      const a2 = await answerDoc(attemptId, questions[1]._id);
      assert(a2?.markedForReview === true, "review not persisted");
      assert((await cellStatus(page, 2)) === "marked", "navigator not marked");

      const t1 = await page.$eval('[role="timer"]', (e) => e.textContent ?? "");
      await page.reload({ waitUntil: "networkidle2" });
      await ready(page);
      assert(pathQ(page) === "2", `position lost: q=${pathQ(page)}`);
      const switchState = await page.$eval('[role="switch"]', (e) =>
        e.getAttribute("aria-checked"),
      );
      assert(switchState === "true", "review lost on refresh");
      assert((await cellStatus(page, 1)) === "answered", "answer lost on refresh");
      const t2 = await page.$eval('[role="timer"]', (e) => e.textContent ?? "");
      const sec = (t: string) =>
        t
          .split(":")
          .map(Number)
          .reduce((a, n) => a * 60 + n, 0);
      assert(sec(t1) - sec(t2) >= 0 && sec(t1) - sec(t2) <= 10, `timer reset (${t1} → ${t2})`);
      return `Q1=C saved, Q2 marked; after refresh: q=2, review on, answer kept, timer ${t1} → ${t2}`;
    } finally {
      await browser.close();
    }
  });

  await test("A4 save failure keeps the selection and stays put; retry saves and moves on", async () => {
    const { exam, user, attemptId, questions } = await running();
    const { browser, page } = await open(user, exam);
    try {
      await ready(page);
      let fail = true;
      await page.setRequestInterception(true);
      page.on("request", (r) => {
        if (fail && isAnswerWrite(r)) return void r.abort("failed");
        void r.continue();
      });
      await page.click(option(page, "B"));
      await page.click("button ::-p-text(Save & Next)");
      await waitText(page, "Couldn't save your answer");
      assert(pathQ(page) === "1", "navigated after a failed save");
      assert((await checked(page, "B")) === "true", "selection lost after failure");
      assert(!(await page.$("::-p-text(Saved at)")), "showed Saved before confirmation");
      assert(
        !(await answerDoc(attemptId, questions[0]._id))?.selectedOptionIds.length,
        "DB written",
      );

      fail = false;
      await page.click("button ::-p-text(Retry Save)");
      await page.waitForFunction(() => new URL(location.href).searchParams.get("q") === "2");
      const saved = await answerDoc(attemptId, questions[0]._id);
      assert(saved?.selectedOptionIds[0] === "b", "retry didn't save");
      return "failure → selection kept, stayed on Q1; retry → saved, moved to Q2";
    } finally {
      await browser.close();
    }
  });

  await test("A5 unsaved answer guard and keyboard safety", async () => {
    const { exam, user, attemptId, questions } = await running();
    const { browser, page } = await open(user, exam);
    try {
      await ready(page);
      // Arrow keys move nothing; Space selects the focused option.
      await page.focus(option(page, "A"));
      await page.keyboard.press("ArrowDown");
      assert((await checked(page, "A")) === "false", "arrow key changed the answer");
      await page.keyboard.press("Space");
      assert((await checked(page, "A")) === "true", "Space didn't select");

      await page.click('[data-question-cell="3"]');
      await waitText(page, "You have an unsaved answer");
      await page.click("button ::-p-text(Stay)");
      await wait(300);
      assert(pathQ(page) === "1", "left the question after Stay");
      await page.click('[data-question-cell="3"]');
      await page.click("button ::-p-text(Discard Change)");
      await page.waitForFunction(() => new URL(location.href).searchParams.get("q") === "3");
      const a1 = await answerDoc(attemptId, questions[0]._id);
      assert(!a1?.selectedOptionIds.length, "discarded answer was saved");
      return "arrows inert, Space selects; Stay keeps Q1; Discard moves on without saving";
    } finally {
      await browser.close();
    }
  });

  await test("A6 camera disconnection is detected, recorded and recoverable", async () => {
    const { exam, user, attemptId } = await running();
    const { browser, page } = await open(user, exam);
    try {
      await ready(page);
      await page.waitForSelector("[data-camera-live]", { timeout: 15000 });
      await page.evaluate(() => {
        const w = window as unknown as { __streams: MediaStream[] };
        w.__streams.forEach((s) => s.getVideoTracks().forEach((t) => t.stop()));
      });
      await page.waitForFunction(
        () =>
          document.querySelector('[data-status-item="camera"]')?.getAttribute("data-tone") ===
          "fail",
        { timeout: 8000 },
      );
      await waitText(page, "Camera disconnected");
      await page.waitForSelector('[data-event="CAMERA_DISCONNECTED"]', { timeout: 8000 });
      const c = await db();
      const recorded = await c.proctoringEvents.findOne({
        attemptId: new ObjectId(attemptId),
        type: "CAMERA_DISCONNECTED",
      });
      assert(recorded?.severity === "HIGH", "event not recorded server-side");
      const audit = await c.auditLogs.countDocuments({
        attemptId: new ObjectId(attemptId),
        eventType: "PROCTORING_EVENT_RECORDED",
      });
      assert(audit >= 1, "no audit entry");

      await page.click("button ::-p-text(Reconnect)");
      await page.waitForSelector("[data-camera-live]", { timeout: 15000 });
      await page.waitForSelector('[data-event="CAMERA_RESTORED"]', { timeout: 8000 });
      return "stopped track → Disconnected + server event + audit; Reconnect → LIVE + restored event";
    } finally {
      await browser.close();
    }
  });

  await test("A7 not-required devices say so instead of claiming ON", async () => {
    const { exam, user } = await running({
      proctoringPolicy: {
        cameraRequired: false,
        microphoneRequired: false,
        screenMonitoringRequired: false,
        fullscreenRequired: false,
        identityVerificationRequired: false,
      },
    });
    const { browser, page } = await open(user, exam);
    try {
      await ready(page);
      await wait(1000);
      for (const id of ["camera", "microphone", "screen", "fullscreen"]) {
        const s = await statusItem(page, id);
        assert(s.text.includes("Not Required"), `${id}: ${s.text}`);
      }
      const media = await mediaReport(page);
      assert(media.liveTracks === 0, "opened devices the exam doesn't require");
      return "camera, microphone, screen monitoring, fullscreen → Not Required; no devices opened";
    } finally {
      await browser.close();
    }
  });

  await test("A8 timeout: auto-submitted by the server, answers locked, media released", async () => {
    const { exam, user, attemptId, questions } = await running();
    await (
      await db()
    ).examAttempts.updateOne(
      { _id: new ObjectId(attemptId) },
      { $set: { expiresAt: new Date(Date.now() + 8000) } },
    );
    const { browser, page } = await open(user, exam);
    try {
      await ready(page);
      await waitText(page, "Time is up", 15000);
      await waitText(page, "submitted automatically", 15000);
      const c = await db();
      const attempt = await c.examAttempts.findOne({ _id: new ObjectId(attemptId) });
      assert(attempt?.status === "AUTO_SUBMITTED", `status ${attempt?.status}`);
      assert(
        (await c.auditLogs.countDocuments({
          attemptId: attempt._id,
          eventType: "EXAM_AUTO_SUBMITTED",
        })) === 1,
        "auto-submit audit",
      );
      const late = await api<{ error: { code: string } }>(
        user,
        "POST",
        `/api/exam-attempts/${attemptId}/answers/${questions[0]._id}`,
        { selectedOptionId: "a", expectedVersion: 0 },
      );
      assert(late.status === 409 && late.data.error.code === "ATTEMPT_SUBMITTED", "write accepted");
      await wait(500);
      assert((await mediaReport(page)).liveTracks === 0, "camera still running after submission");
      return "deadline → AUTO_SUBMITTED once, late write → 409, camera released";
    } finally {
      await browser.close();
    }
  });

  await test("A9 End Exam submits through the server, once", async () => {
    const { exam, user, attemptId } = await running();
    const { browser, page } = await open(user, exam);
    try {
      await ready(page);
      await page.click("button ::-p-text(End Exam)");
      await waitText(page, "Submit and end the exam?");
      await page.click("button ::-p-text(Submit & End Exam)");
      await waitText(page, "This exam has been submitted.", 10000);
      const c = await db();
      const attempt = await c.examAttempts.findOne({ _id: new ObjectId(attemptId) });
      assert(attempt?.status === "SUBMITTED", `status ${attempt?.status}`);
      const again = await api<{ attempt: { status: string } }>(
        user,
        "POST",
        `/api/exam-attempts/${attemptId}/submit`,
        {},
      );
      assert(again.status === 200 && again.data.attempt.status === "SUBMITTED", "not idempotent");
      const audits = await c.auditLogs.countDocuments({
        attemptId: attempt._id,
        eventType: "EXAM_SUBMITTED",
      });
      assert(audits === 1, `${audits} submit audits`);
      return "dialog → SUBMITTED, repeat submit → same result, 1 audit event";
    } finally {
      await browser.close();
    }
  });

  await test("A10 inactive attempts can't open the exam screen or its API", async () => {
    const exam = await createE2EExam({ proctoringPolicy: NO_IDENTITY });
    await createE2EQuestions(exam, 3);
    const user = await createE2ECandidate();
    const attemptId = await attemptAtIdentity(user, exam); // READY, not started
    const paper = await api(user, "GET", `/api/exam-attempts/${attemptId}/paper`);
    assert(paper.status === 409, `paper before start → ${paper.status}`);
    const { browser, page } = await open(user, exam);
    try {
      await page.waitForFunction(() => location.pathname.endsWith("/start"), { timeout: 10000 });
      const other = await createE2ECandidate("Someone Else");
      const { attemptId: theirs } = await running();
      const stolen = await api(other, "GET", `/api/exam-attempts/${theirs}/paper`);
      assert(stolen.status === 404, `another candidate's paper → ${stolen.status}`);
      return "READY → /active redirects to /start; paper → 409; another candidate → 404";
    } finally {
      await browser.close();
    }
  });

  await test("A11 layout: no horizontal overflow, controls reachable at target sizes", async () => {
    const { exam, user } = await running({}, 50);
    const out: string[] = [];
    for (const [width, height] of [
      [1920, 1080],
      [1536, 1024],
      [1440, 900],
      [1280, 800],
    ] as const) {
      const { browser, page } = await open(user, exam, 12, { width, height });
      try {
        await ready(page);
        const m = await page.evaluate(() => {
          const save = [...document.querySelectorAll("button")].find((b) =>
            /Save & Next|Next/.test(b.textContent ?? ""),
          );
          return {
            overflowX: document.documentElement.scrollWidth - window.innerWidth,
            pageScroll: document.documentElement.scrollHeight - window.innerHeight,
            saveBottom: save?.getBoundingClientRect().bottom ?? 0,
          };
        });
        assert(m.overflowX <= 0, `${width}×${height}: horizontal overflow ${m.overflowX}px`);
        assert(
          m.saveBottom <= height - 68,
          `${width}×${height}: Save hidden behind the status bar`,
        );
        await page.screenshot({ path: `${OUT}/a11-active-${width}x${height}.png` });
        out.push(`${width}×${height}${m.pageScroll > 0 ? ` (page scroll ${m.pageScroll}px)` : ""}`);
      } finally {
        await browser.close();
      }
    }
    return out.join(", ");
  });
}

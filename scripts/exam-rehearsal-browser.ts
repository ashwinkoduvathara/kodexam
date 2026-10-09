/**
 * Browser rehearsal: one candidate's full journey in real Chrome (fake camera/mic)
 * through the public URL, on the REHEARSAL exam: invite → system check →
 * instructions → start → answer → submit. The test candidate is removed afterwards.
 *
 *   npx tsx scripts/exam-rehearsal-browser.ts https://<public-url> [screenshot-dir]
 */
import puppeteer from "puppeteer-core";
import { closeMongoClient, getDb } from "@/server/db/mongodb";
import {
  createInviteService,
  ensureInviteIndexes,
  INVITES_COLLECTION,
} from "@/server/invites/invite-service";

const base = process.argv[2];
const OUT = process.argv[3] ?? "e2e/.output";
const db = await getDb();
await ensureInviteIndexes(db);
const email = "ui.rehearsal@rehearsal.kproctor.test";
const name = "UI Rehearsal Candidate";
const { code } = await createInviteService(db).createInvite({
  examRef: "MERN-101-DRY",
  email,
  fullName: name,
  createdBy: "rehearsal",
});
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const errors: string[] = [];
const step = (s: string) => console.log(`✓ ${s}`);
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push((e as Error).message));
  page.on(
    "console",
    (m) =>
      m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()),
  );
  await page.setViewport({ width: 1440, height: 900 });
  const text = (t: string, timeout = 20000) =>
    page.waitForFunction((x) => document.body.innerText.includes(x), { timeout, polling: 200 }, t);
  const enabled = (t: string, timeout = 30000) =>
    page.waitForFunction(
      (x) =>
        [...document.querySelectorAll("button")].some(
          (b) => b.textContent?.includes(x) && !b.disabled,
        ),
      { timeout, polling: 200 },
      t,
    );

  await page.goto(`${base}/invite`, { waitUntil: "networkidle2" });
  await page.type('input[autocomplete="name"]', name);
  await page.type('input[type="email"]', email);
  await page.type('input[placeholder="e.g. KP-XXXX-XXXX"]', code);
  await page.click("button[type=submit]");
  await page.waitForFunction(() => location.pathname.endsWith("/system-check"), { timeout: 30000 });
  step("invite accepted over HTTPS → System Check");

  await page.waitForSelector('[data-check="speaker"]', { timeout: 30000 });
  // Wait until the speaker card's Play button is enabled, then click it (same as the e2e suite).
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('[data-check="speaker"] button')].some(
        (b) => b.textContent?.includes("Play") && !(b as HTMLButtonElement).disabled,
      ),
    { timeout: 30000, polling: 200 },
  );
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('[data-check="speaker"] button')].find((x) =>
      x.textContent?.includes("Play"),
    ) as HTMLButtonElement;
    b.click();
  });
  await text("Did you hear the test sound?");
  await page.click("button ::-p-text(Yes, I heard it)");
  await enabled("All Good, Continue", 45000);
  step("camera, microphone, speaker and network checks passed");
  await page.click("button ::-p-text(All Good, Continue)");
  await page.waitForFunction(() => location.pathname.endsWith("/instructions"), { timeout: 20000 });
  await page.waitForSelector('label[for="instructions-acknowledgement"]', { timeout: 20000 });
  await page.click('label[for="instructions-acknowledgement"]');
  await page.click("button:not([disabled]) ::-p-text(I Understand, Continue)");
  await page.waitForFunction(() => location.pathname.endsWith("/start"), { timeout: 20000 });
  step("instructions acknowledged → Start Exam (identity step skipped by policy)");
  await page.screenshot({ path: `${OUT}/rehearsal-start.png` });

  await page.waitForSelector('label[for="start-acknowledgement"]', { timeout: 20000 });
  await page.click('label[for="start-acknowledgement"]');
  await enabled("Start Exam");
  await page.click("button ::-p-text(Start Exam)");
  await page.waitForSelector('[role="radiogroup"]', { timeout: 30000 });
  await page.waitForSelector("[data-camera-live]", { timeout: 20000 });
  step("exam started: 30 questions loaded, live camera feed");
  await page.click('[data-option="B"]');
  await page.click("button ::-p-text(Save & Next)");
  await page.waitForFunction(() => new URL(location.href).searchParams.get("q") === "2", {
    timeout: 20000,
  });
  step("answer saved, moved to question 2");
  await page.screenshot({ path: `${OUT}/rehearsal-active.png` });

  await page.click("button ::-p-text(End Exam)");
  await text("Submit and end the exam?");
  await page.click("button ::-p-text(Submit & End Exam)");
  await text("This exam has been submitted.");
  step("submitted through the server");
  console.log(errors.length ? `console errors: ${errors.join(" | ")}` : "no console errors");
} finally {
  await browser.close();
  const user = await db.collection("users").findOne({ email });
  if (user) {
    const attempts = await db
      .collection("examAttempts")
      .find({ candidateId: user._id })
      .project({ _id: 1 })
      .toArray();
    const ids = attempts.map((a) => a._id);
    await Promise.all([
      db.collection("candidateAnswers").deleteMany({ attemptId: { $in: ids } }),
      db.collection("proctoringEvents").deleteMany({ attemptId: { $in: ids } }),
      db.collection("examSessions").deleteMany({ attemptId: { $in: ids } }),
      db
        .collection("auditLogs")
        .deleteMany({ $or: [{ attemptId: { $in: ids } }, { candidateId: user._id }] }),
      db.collection("examAttempts").deleteMany({ _id: { $in: ids } }),
    ]);
    await db.collection("users").deleteOne({ _id: user._id });
  }
  await db.collection(INVITES_COLLECTION).deleteMany({ email });
  await closeMongoClient();
}

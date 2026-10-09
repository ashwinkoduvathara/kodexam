/**
 * External Candidate Exam Invite Portal — browser scenarios against the real
 * API and MongoDB. Run with: npx tsx e2e/invite-run.ts
 */
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { getDb } from "@/server/db/mongodb";
import { createInviteService, ensureInviteIndexes } from "@/server/invites/invite-service";
import { assert, BASE, createE2EExam, OUT, test, waitText } from "./lib";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
export const INVITE_EMAIL_DOMAIN = "invite-e2e.test";

async function freshPage(
  width = 1536,
  height = 1024,
): Promise<{ browser: Browser; page: Page; errors: string[] }> {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${(e as Error).message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  await page.setViewport({ width, height });
  await page.goto(`${BASE}/invite`, { waitUntil: "networkidle2" });
  await waitText(page, "Access Your Examination");
  return { browser, page, errors };
}

async function makeInvite(name = "Kavya Menon") {
  const db = await getDb();
  await ensureInviteIndexes(db);
  const exam = await createE2EExam({
    proctoringPolicy: {
      cameraRequired: true,
      microphoneRequired: true,
      screenMonitoringRequired: false,
      fullscreenRequired: true,
      identityVerificationRequired: false,
    },
  });
  const email = `${name.split(" ")[0].toLowerCase()}.${Date.now()}@${INVITE_EMAIL_DOMAIN}`;
  const { code } = await createInviteService(db).createInvite({
    examRef: exam.examCode,
    email,
    fullName: name,
    createdBy: "e2e",
  });
  return { exam, email, code, name };
}

async function fill(page: Page, values: { name: string; email: string; code: string }) {
  await page.type('input[autocomplete="name"]', values.name);
  await page.type('input[type="email"]', values.email);
  await page.type('input[placeholder="e.g. KP-XXXX-XXXX"]', values.code);
}

export async function runInviteSuite() {
  await test("I1 portal renders from the design, accessible, no overflow at common sizes", async () => {
    const out: string[] = [];
    for (const [w, h] of [
      [1536, 1024],
      [1280, 800],
      [390, 844],
    ] as const) {
      const { browser, page, errors } = await freshPage(w, h);
      try {
        for (const text of [
          "You’ve been invited.",
          "Secure Access",
          "Verified Identity",
          "Monitored Examination",
          "Time Bound",
          "Verify Invite & Continue",
          "Important Information",
          "I am a Kodeversity student",
        ]) {
          await waitText(page, text);
        }
        const labels = await page.$$eval(
          "label[for]",
          (ls) => ls.filter((l) => document.getElementById(l.getAttribute("for")!)).length,
        );
        assert(labels === 3, `${labels} labelled inputs`);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        assert(overflow <= 0, `${w}×${h}: horizontal overflow ${overflow}px`);
        assert(errors.length === 0, errors.join("; "));
        await page.screenshot({ path: `${OUT}/invite-${w}x${h}.png`, fullPage: w < 600 });
        out.push(`${w}×${h}`);
      } finally {
        await browser.close();
      }
    }
    return `rendered at ${out.join(", ")}`;
  });

  await test("I2 client validation: empty form shows field errors and sends nothing", async () => {
    const { browser, page } = await freshPage();
    try {
      let requests = 0;
      page.on("request", (r) => {
        if (r.url().includes("/api/invites/verify")) requests += 1;
      });
      await page.click("button[type=submit]");
      await waitText(page, "Enter your full name as per the invitation.");
      await waitText(page, "Enter the email address the invitation was sent to.");
      await waitText(page, "Enter the invite code in the format KP-XXXX-XXXX.");
      const focused = await page.evaluate(() =>
        document.activeElement?.getAttribute("autocomplete"),
      );
      assert(focused === "name", `focus on ${focused}`);
      const invalid = await page.$$eval("input[aria-invalid=true]", (els) => els.length);
      assert(invalid === 3 && requests === 0, `${invalid} invalid, ${requests} requests`);
      return "3 field errors, focus on the first, no request";
    } finally {
      await browser.close();
    }
  });

  await test("I3 a wrong invite gets the generic message and no session", async () => {
    const { email, name } = await makeInvite();
    const { browser, page } = await freshPage();
    try {
      await fill(page, { name, email, code: "KP-AAAA-BBBB" });
      await page.click("button[type=submit]");
      await waitText(page, "We couldn't verify this invitation.");
      const cookies = await page.cookies();
      assert(!cookies.some((c) => c.name === "kp_session"), "session cookie set on failure");
      assert(new URL(page.url()).pathname === "/invite", "navigated away");
      return "generic error, no cookie, still on /invite";
    } finally {
      await browser.close();
    }
  });

  await test("I4 a valid invite (typed without dashes, Enter to submit) opens the exam flow", async () => {
    const { exam, email, code, name } = await makeInvite("Rohan Iyer");
    const { browser, page, errors } = await freshPage();
    try {
      await fill(page, {
        name: name.toLowerCase(),
        email: email.toUpperCase(),
        code: code.replace(/-/g, "").toLowerCase(),
      });
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        (id) =>
          location.pathname.startsWith(`/exam/${id}`) &&
          location.pathname.endsWith("/system-check"),
        { timeout: 20000 },
        exam._id.toHexString(),
      );
      await waitText(page, "Rohan Iyer", 15000);
      const cookie = (await page.cookies()).find((c) => c.name === "kp_session");
      assert(cookie?.httpOnly, "session cookie missing or not HttpOnly");
      assert(errors.length === 0, errors.join("; "));
      return "→ /exam/:id/system-check as the invited candidate; HttpOnly session";
    } finally {
      await browser.close();
    }
  });
}

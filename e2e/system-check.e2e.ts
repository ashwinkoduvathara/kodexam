/**
 * Screen 1 — System Check regression suite, against the real session API.
 */
import { ObjectId } from "mongodb";
import type { Page } from "puppeteer-core";
import type { UserDoc } from "@/server/db/collections";
import {
  api,
  assert,
  BASE,
  buttonState,
  card,
  click,
  createE2ECandidate,
  createE2EExam,
  db,
  mediaReport,
  openBrowser,
  OUT,
  test,
  wait,
  waitButton,
  waitStatus,
  waitText,
  type OpenOptions,
} from "./lib";

const CONTINUE = "All Good, Continue";

async function fresh(opts: Partial<OpenOptions> = {}, deadlineInSeconds?: number) {
  const exam = await createE2EExam();
  const user = await createE2ECandidate();
  if (deadlineInSeconds !== undefined) {
    const start = await api<{ attempt: { id: string } }>(
      user,
      "POST",
      `/api/exams/${exam._id}/attempts`,
      {},
    );
    await (
      await db()
    ).examAttempts.updateOne(
      { _id: new ObjectId(start.data.attempt.id) },
      { $set: { expiresAt: new Date(Date.now() + deadlineInSeconds * 1000) } },
    );
  }
  const session = await openBrowser({ user, path: `/exam/${exam._id}/system-check`, ...opts });
  await session.page.waitForSelector("[data-check]", { timeout: 15000 });
  return { ...session, exam, user };
}

async function passSpeaker(page: Page) {
  await click(page, "Play", '[data-check="speaker"]');
  await waitText(page, "Did you hear the test sound?", 8000);
  await click(page, "Yes, I heard it");
  await waitStatus(page, "speaker", ["passed"]);
}

async function passAll(page: Page) {
  await waitStatus(page, "camera", ["passed"]);
  await waitStatus(page, "microphone", ["passed"]);
  await waitStatus(page, "network", ["passed", "warning"]);
  await passSpeaker(page);
  await waitButton(page, CONTINUE, true);
}

const attemptOf = async (user: UserDoc) =>
  (await db()).examAttempts.findOne({ candidateId: user._id });

export async function runSystemCheckSuite() {
  await test("T1 all permissions allowed → Continue saves and opens Instructions", async () => {
    const { browser, page, errors, user } = await fresh();
    try {
      await waitStatus(page, "camera", ["passed"]);
      await waitStatus(page, "microphone", ["passed"]);
      await waitStatus(page, "network", ["passed", "warning"]);
      assert((await buttonState(page, CONTINUE))?.disabled, "Continue enabled before speaker");

      // Speaker via keyboard only.
      let focused = "";
      for (let i = 0; i < 80 && !focused.includes("Play Test Sound"); i++) {
        await page.keyboard.press("Tab");
        focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
      }
      assert(focused.includes("Play Test Sound"), "Play Test Sound not reachable by keyboard");
      const outline = await page.evaluate(
        () => getComputedStyle(document.activeElement!).outlineStyle,
      );
      assert(outline !== "none", "no visible focus outline");
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        () => document.activeElement?.textContent?.includes("Yes, I heard it"),
        { timeout: 8000 },
      );
      await page.keyboard.press("Enter");
      await waitStatus(page, "speaker", ["passed"]);
      await waitButton(page, CONTINUE, true);
      await wait(400);
      await page.screenshot({ path: `${OUT}/s1-ready-1440.png` });

      await click(page, CONTINUE);
      await page.waitForFunction(() => location.pathname.endsWith("/instructions"), {
        timeout: 10000,
      });
      await waitText(page, "Exam Overview");
      const attempt = await attemptOf(user);
      assert(attempt?.status === "INSTRUCTIONS", `status ${attempt?.status}`);
      assert(attempt.systemCheck.completedAt instanceof Date, "system check not recorded");
      const media = await mediaReport(page);
      assert(media.liveTracks === 0, "camera/mic still live after leaving System Check");
      assert(errors.length === 0, errors.join(" | "));
      return `results ${JSON.stringify({ ...attempt.systemCheck, completedAt: undefined })}; media released`;
    } finally {
      await browser.close();
    }
  });

  for (const [name, grant, denied, other] of [
    ["T2 camera denied", ["microphone"], "camera", "microphone"],
    ["T3 microphone denied", ["camera"], "microphone", "camera"],
  ] as const) {
    await test(name, async () => {
      const { browser, page } = await fresh({ deny: true, grant: [...grant] });
      try {
        await waitStatus(page, denied, ["failed"]);
        await waitStatus(page, other, ["passed"]);
        const c = await card(page, denied);
        assert(c.badge === "Permission Required", `badge ${c.badge}`);
        assert((await buttonState(page, CONTINUE))?.disabled, "Continue enabled");
        return `${denied}: ${c.badge}`;
      } finally {
        await browser.close();
      }
    });
  }

  for (const [name, sim, id, label] of [
    ["T4 no camera", { noCamera: true }, "camera", "No Camera"],
    ["T5 no microphone", { noMic: true }, "microphone", "No Microphone"],
  ] as const) {
    await test(name, async () => {
      const { browser, page } = await fresh({ sim });
      try {
        await waitStatus(page, id, ["not_available"]);
        const c = await card(page, id);
        assert(c.badge === label, `badge ${c.badge}`);
        assert((await buttonState(page, CONTINUE))?.disabled, "Continue enabled");
        return c.badge;
      } finally {
        await browser.close();
      }
    });
  }

  await test("T6 speaker answered NO", async () => {
    const { browser, page } = await fresh();
    try {
      await click(page, "Play Test Sound");
      await waitText(page, "No, try again", 8000);
      await click(page, "No, try again");
      await wait(300);
      const c = await card(page, "speaker");
      assert(c.status === "failed" && c.badge === "Not Heard", `${c.status}/${c.badge}`);
      assert((await buttonState(page, CONTINUE))?.disabled, "Continue enabled");
      return "Not Heard, Continue disabled";
    } finally {
      await browser.close();
    }
  });

  await test("T7/T8 internet disconnect + reconnect", async () => {
    const { browser, page } = await fresh();
    try {
      await passAll(page);
      const t0 = Date.now();
      await page.setOfflineMode(true);
      await waitButton(page, CONTINUE, false, 3000);
      const ms = Date.now() - t0;
      assert((await card(page, "network")).badge === "Connection Lost", "no Connection Lost");
      await page.setOfflineMode(false);
      await waitStatus(page, "network", ["checking"], 5000);
      assert((await buttonState(page, CONTINUE))?.disabled, "enabled during re-test");
      await waitStatus(page, "network", ["passed", "warning"]);
      await waitButton(page, CONTINUE, true);
      return `disabled ${ms}ms after offline; re-enabled after re-test`;
    } finally {
      await browser.close();
    }
  });

  await test("T9/T14 change camera", async () => {
    const { browser, page } = await fresh({
      flags: ["--use-fake-device-for-media-stream=device-count=2"],
    });
    try {
      await waitStatus(page, "camera", ["passed"]);
      const before = await page.evaluate(() => {
        const v = document.querySelector('[data-check="camera"] video') as HTMLVideoElement;
        const w = window as unknown as { __streams: MediaStream[] };
        return {
          idx: w.__streams.indexOf(v.srcObject as MediaStream),
          label: (v.srcObject as MediaStream).getVideoTracks()[0].label,
        };
      });
      await page.click('[aria-label="Change camera"]');
      await page.waitForSelector('[role="menuitemradio"]');
      const count = (await page.$$('[role="menuitemradio"]')).length;
      await (await page.$('[role="menuitemradio"][aria-checked="false"]'))!.click();
      await wait(300);
      await waitStatus(page, "camera", ["passed"]);
      const after = await page.evaluate((i) => {
        const v = document.querySelector('[data-check="camera"] video') as HTMLVideoElement;
        const w = window as unknown as { __streams: MediaStream[] };
        return {
          oldEnded: w.__streams[i].getTracks().every((t) => t.readyState === "ended"),
          label: (v.srcObject as MediaStream).getVideoTracks()[0].label,
          width: v.videoWidth,
        };
      }, before.idx);
      assert(
        count >= 2 && after.oldEnded && after.label !== before.label && after.width > 0,
        JSON.stringify(after),
      );
      return `${count} cameras; ${before.label} → ${after.label}; old stream stopped`;
    } finally {
      await browser.close();
    }
  });

  await test("T15 change microphone", async () => {
    const { browser, page } = await fresh();
    try {
      await waitStatus(page, "microphone", ["passed"]);
      await page.click('[aria-label="Change microphone"]');
      await page.waitForSelector('[role="menuitemradio"]');
      const count = (await page.$$('[role="menuitemradio"]')).length;
      await (await page.$('[role="menuitemradio"][aria-checked="false"]'))!.click();
      await wait(500);
      await waitStatus(page, "microphone", ["passed"]);
      const oldEnded = await page.evaluate(() => {
        const w = window as unknown as { __streams: MediaStream[] };
        const mics = w.__streams.filter((s) => s.getAudioTracks().length);
        return mics.slice(0, -1).every((s) => s.getTracks().every((t) => t.readyState === "ended"));
      });
      assert(count >= 2 && oldEnded, `count ${count}, oldEnded ${oldEnded}`);
      return `${count} microphones; switched; old tracks stopped`;
    } finally {
      await browser.close();
    }
  });

  await test("T10 leave page releases camera, microphone and AudioContexts", async () => {
    const { browser, page } = await fresh();
    try {
      await waitStatus(page, "camera", ["passed"]);
      await waitStatus(page, "microphone", ["passed"]);
      await click(page, "Play Test Sound");
      await wait(500);
      const before = await mediaReport(page);
      await page.evaluate(() => {
        history.pushState({}, "", "/not-an-exam-route");
        dispatchEvent(new PopStateEvent("popstate", { state: {} }));
      });
      await waitText(page, "Page not found", 5000);
      await wait(400);
      const after = await mediaReport(page);
      assert(
        after.liveTracks === 0 && after.ctxs.every((s) => s === "closed"),
        JSON.stringify(after),
      );
      return `${before.liveTracks} live → 0; ${before.ctxs.length} AudioContexts closed`;
    } finally {
      await browser.close();
    }
  });

  await test("T10b pagehide releases media", async () => {
    const { browser, page } = await fresh();
    try {
      await waitStatus(page, "camera", ["passed"]);
      await waitStatus(page, "microphone", ["passed"]);
      await page.evaluate(() =>
        dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })),
      );
      await wait(300);
      const r = await mediaReport(page);
      assert(r.liveTracks === 0 && r.ctxs.every((s) => s === "closed"), JSON.stringify(r));
      return "released";
    } finally {
      await browser.close();
    }
  });

  for (const [name, seconds, tone] of [
    ["T11 timer amber at 10 min", 602, "warning"],
    ["T12 timer red at 5 min", 302, "critical"],
  ] as const) {
    await test(name, async () => {
      const { browser, page } = await fresh({}, seconds);
      try {
        await page.waitForFunction(
          (t) => document.querySelector("[data-tone]")?.getAttribute("data-tone") === t,
          { timeout: 6000 },
          tone,
        );
        return `${tone} at ${await page.$eval('[role="timer"]', (e) => e.textContent)}`;
      } finally {
        await browser.close();
      }
    });
  }

  await test("T-expiry session expires on Screen 1", async () => {
    const { browser, page } = await fresh({}, 6);
    try {
      await waitText(page, "Exam session has expired.", 12000);
      await wait(400);
      const r = await mediaReport(page);
      assert(r.liveTracks === 0, "media still live");
      assert(!(await buttonState(page, CONTINUE)), "Continue still offered");
      return "notice shown, media released";
    } finally {
      await browser.close();
    }
  });

  await test("T13 permission denied then restored", async () => {
    const { browser, page } = await fresh({ deny: true, grant: [] });
    try {
      await waitStatus(page, "camera", ["failed"]);
      await browser.defaultBrowserContext().overridePermissions(BASE, ["camera", "microphone"]);
      await waitStatus(page, "camera", ["passed"]);
      await waitStatus(page, "microphone", ["passed"]);
      return "recovered after grant";
    } finally {
      await browser.close();
    }
  });

  await test("T13b Try Again re-initialises", async () => {
    const { browser, page } = await fresh({ sim: { busyCamera: true } });
    try {
      await waitStatus(page, "camera", ["failed"]);
      await wait(1000);
      await page.evaluate(
        () => ((window as unknown as { __sim: { busyCamera: boolean } }).__sim.busyCamera = false),
      );
      await click(page, "Try Again", '[data-check="camera"]');
      await waitStatus(page, "camera", ["passed"]);
      return "Device Error → Try Again → passed";
    } finally {
      await browser.close();
    }
  });

  await test("X1 End Exam ends the attempt on the server", async () => {
    const { browser, page, user } = await fresh();
    try {
      await waitStatus(page, "camera", ["passed"]);
      await click(page, "End Exam");
      await page.waitForSelector('[role="alertdialog"]');
      const text = await page.$eval('[role="alertdialog"]', (e) => (e as HTMLElement).innerText);
      assert(text.includes("End Examination?"), "dialog copy");
      await click(page, "End Exam", '[role="alertdialog"]');
      await waitText(page, "This exam attempt has ended.");
      await wait(400);
      const attempt = await attemptOf(user);
      const audit = await (
        await db()
      ).auditLogs.countDocuments({ attemptId: attempt!._id, eventType: "ATTEMPT_CANCELLED" });
      const media = await mediaReport(page);
      assert(
        attempt?.status === "CANCELLED" && audit === 1 && media.liveTracks === 0,
        JSON.stringify({ s: attempt?.status, audit, media }),
      );
      return "CANCELLED in DB, audited, closed state shown, media released";
    } finally {
      await browser.close();
    }
  });

  await test("X2 Support dialog", async () => {
    const { browser, page } = await fresh();
    try {
      await click(page, "Contact Support", "aside");
      await page.waitForSelector('[role="dialog"]');
      const t = await page.$eval('[role="dialog"]', (e) => (e as HTMLElement).innerText);
      for (const s of ["Technical Support", "info@kodeversity.com", "Support hours"])
        assert(t.includes(s), `missing ${s}`);
      return "shown";
    } finally {
      await browser.close();
    }
  });
}

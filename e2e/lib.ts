/**
 * Shared harness for the KProctor browser tests (run with `npm run test:e2e`).
 *
 * Requires: the app running at E2E_BASE_URL (default http://localhost:3100),
 * the same MongoDB the app uses, and Chrome (CHROME_PATH).
 * Fixtures are created per scenario with an E2E- prefix and removed afterwards.
 */
import { ObjectId } from "mongodb";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { signCandidateToken } from "@/server/auth/candidate-auth";
import { getCollections, USER_ROLE, type ExamDoc, type UserDoc } from "@/server/db/collections";
import { getDb } from "@/server/db/mongodb";
import { createQuestions } from "@/server/test/fixtures";
import { fakeJpeg, fakePng } from "@/server/test/identity-fixtures";
import { DEFAULT_EXAM_INSTRUCTIONS, EXAM_STATUS } from "@/types/exam";

export const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
export const OUT = process.env.E2E_OUT_DIR ?? "e2e/.output";

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

export async function db() {
  return getCollections(await getDb());
}

/** A distinctive exam so the UI can be proven to render database values. */
export async function createE2EExam(overrides: Partial<ExamDoc> = {}): Promise<ExamDoc> {
  const now = new Date();
  const exam: ExamDoc = {
    _id: new ObjectId(),
    examCode: `E2E-${new ObjectId().toHexString().slice(-6).toUpperCase()}`,
    name: "Distributed Systems",
    description: "",
    durationMinutes: 75,
    totalQuestions: 42,
    totalMarks: 120,
    passingMarks: 48,
    attemptLimit: 2,
    status: EXAM_STATUS.PUBLISHED,
    instructions: DEFAULT_EXAM_INSTRUCTIONS,
    proctoringPolicy: {
      cameraRequired: true,
      microphoneRequired: true,
      screenMonitoringRequired: true,
      fullscreenRequired: true,
      identityVerificationRequired: true,
    },
    securityPolicy: {
      allowTabSwitch: false,
      allowExternalDevices: false,
      allowBackNavigation: false,
      allowPause: false,
      autoSubmitOnExpiry: true,
    },
    startAt: new Date(now.getTime() - 60 * 60_000),
    endAt: new Date(now.getTime() + 24 * 60 * 60_000),
    createdBy: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  await (await db()).exams.insertOne(exam);
  return exam;
}

export async function createE2ECandidate(name = "Riya Thomas"): Promise<UserDoc> {
  const now = new Date();
  const user: UserDoc = {
    _id: new ObjectId(),
    role: USER_ROLE.CANDIDATE,
    name,
    email: null,
    rollNumber: `E2E-${new ObjectId().toHexString().slice(-8).toUpperCase()}`,
    avatarUrl: null,
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  };
  await (await db()).users.insertOne(user);
  return user;
}

export async function cleanupE2E() {
  const c = await db();
  const exams = await c.exams.find({ examCode: /^E2E-/ }).project({ _id: 1 }).toArray();
  const examIds = exams.map((e) => e._id);
  const attempts = await c.examAttempts
    .find({ examId: { $in: examIds } })
    .project({ _id: 1 })
    .toArray();
  const attemptIds = attempts.map((a) => a._id);
  await Promise.all([
    c.identityVerifications.deleteMany({ attemptId: { $in: attemptIds } }),
    c.candidateAnswers.deleteMany({ attemptId: { $in: attemptIds } }),
    c.proctoringEvents.deleteMany({ attemptId: { $in: attemptIds } }),
    c.questions.deleteMany({ examId: { $in: examIds } }),
    c.auditLogs.deleteMany({ attemptId: { $in: attemptIds } }),
    c.examSessions.deleteMany({ attemptId: { $in: attemptIds } }),
    c.examAttempts.deleteMany({ _id: { $in: attemptIds } }),
    c.exams.deleteMany({ _id: { $in: examIds } }),
    c.users.deleteMany({ rollNumber: /^E2E-/ }),
  ]);
}

export const tokenFor = (user: UserDoc) => signCandidateToken(user._id.toHexString());

/** Calls the real API as a candidate (server-to-server, like a second device would). */
export async function api<T = unknown>(
  user: UserDoc,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${tokenFor(user)}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as T };
}

/** Starts an attempt and records a passed system check through the API → status INSTRUCTIONS. */
export async function attemptAtInstructions(user: UserDoc, exam: ExamDoc): Promise<string> {
  const start = await api<{ attempt: { id: string } }>(
    user,
    "POST",
    `/api/exams/${exam._id}/attempts`,
    {},
  );
  assert(start.status === 201, `start attempt → ${start.status}`);
  const res = await api(user, "POST", `/api/exam-attempts/${start.data.attempt.id}/system-check`, {
    results: { camera: "passed", microphone: "passed", speaker: "passed", network: "passed" },
  });
  assert(res.status === 200, `system-check → ${res.status}`);
  return start.data.attempt.id;
}

/** Walks an attempt through Screens 1–2 via the API → status IDENTITY_VERIFICATION. */
export async function attemptAtIdentity(user: UserDoc, exam: ExamDoc): Promise<string> {
  const attemptId = await attemptAtInstructions(user, exam);
  const res = await api(
    user,
    "POST",
    `/api/exam-attempts/${attemptId}/instructions/acknowledge`,
    {},
  );
  assert(res.status === 200, `acknowledge → ${res.status}`);
  return attemptId;
}

/** Uploads raw bytes to the real API as a candidate (identity capture / document). */
async function apiBytes(
  user: UserDoc,
  path: string,
  bytes: Uint8Array,
  headers: Record<string, string>,
): Promise<number> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${tokenFor(user)}`, ...headers },
    body: bytes as BodyInit,
  });
  await res.arrayBuffer();
  return res.status;
}

/** A proctor assigned to review this exam's identity verifications. */
export async function createExaminer(exam: ExamDoc): Promise<UserDoc> {
  const user = await createE2ECandidate("E2E Examiner");
  const c = getCollections(await getDb());
  await c.users.updateOne({ _id: user._id }, { $set: { role: USER_ROLE.PROCTOR } });
  await c.exams.updateOne({ _id: exam._id }, { $addToSet: { examinerIds: user._id } });
  return { ...user, role: USER_ROLE.PROCTOR };
}

/**
 * Walks an attempt through Screens 1–3 via the real API: photo, document,
 * consent, then an examiner's approval → status READY with identity VERIFIED.
 * With `approve: false` it stops at REVIEW_REQUIRED.
 */
export async function attemptAtStart(
  user: UserDoc,
  exam: ExamDoc,
  { approve = true }: { approve?: boolean } = {},
): Promise<string> {
  const attemptId = await attemptAtIdentity(user, exam);
  const base = `/api/exam-attempts/${attemptId}/identity`;
  assert((await api(user, "POST", `${base}/start`, {})).status === 200, "identity start");
  const photo = await apiBytes(user, `${base}/capture`, fakeJpeg(), {
    "content-type": "image/jpeg",
  });
  assert(photo === 200, `capture → ${photo}`);
  const doc = await apiBytes(user, `${base}/document`, fakePng(), {
    "content-type": "image/png",
    "x-file-extension": "png",
    "x-document-type": "PASSPORT",
  });
  assert(doc === 200, `document → ${doc}`);
  const verify = await api(user, "POST", `${base}/verify`, { consent: true });
  assert(verify.status === 200, `verify → ${verify.status}`);
  if (!approve) return attemptId;

  const c = await db();
  const v = await c.identityVerifications.findOne({ attemptId: new ObjectId(attemptId) });
  assert(v?.status === "REVIEW_REQUIRED", `identity ${v?.status}`);
  const examiner = await createExaminer(exam);
  const decision = await api(
    examiner,
    "POST",
    `/api/review/identity-verifications/${v._id}/decision`,
    { decision: "APPROVE", expectedVersion: v.version },
  );
  assert(decision.status === 200, `decision → ${decision.status}`);
  const attempt = await c.examAttempts.findOne({ _id: new ObjectId(attemptId) });
  assert(attempt?.status === "READY", `attempt ${attempt?.status}`);
  return attemptId;
}

/** Inserts single-choice questions for an E2E exam (options a–d; correct "b", server-side only). */
export async function createE2EQuestions(exam: ExamDoc, count: number, sectionIds: string[] = []) {
  return createQuestions(await getDb(), exam, count, sectionIds);
}

/** Walks an attempt (exam without identity verification) to IN_PROGRESS through the API. */
export async function attemptRunning(user: UserDoc, exam: ExamDoc): Promise<string> {
  const attemptId = await attemptAtIdentity(user, exam);
  const started = await api<{ attempt: { status: string } }>(
    user,
    "POST",
    `/api/exam-attempts/${attemptId}/start-exam`,
    {},
  );
  assert(started.data.attempt?.status === "IN_PROGRESS", `start-exam → ${started.status}`);
  return attemptId;
}

// ─── Browser ─────────────────────────────────────────────────────────────────

/** Records every capture stream + AudioContext; optionally simulates missing/busy devices. */
const instrument = (sim: Record<string, unknown>) => `(() => {
  window.__streams = []; window.__ctxs = [];
  const sim = (window.__sim = ${JSON.stringify(sim)});
  const md = navigator.mediaDevices;
  const gum = md.getUserMedia.bind(md), en = md.enumerateDevices.bind(md);
  md.getUserMedia = async (c) => {
    if (sim.noCamera && c && c.video) throw new DOMException("Requested device not found", "NotFoundError");
    if (sim.noMic && c && c.audio) throw new DOMException("Requested device not found", "NotFoundError");
    if (sim.busyCamera && c && c.video) throw new DOMException("Could not start video source", "NotReadableError");
    const s = await gum(c); window.__streams.push(s); return s;
  };
  md.enumerateDevices = async () => (await en()).filter((d) =>
    !(sim.noCamera && d.kind === "videoinput") && !(sim.noMic && d.kind === "audioinput"));
  const AC = window.AudioContext;
  window.AudioContext = class extends AC { constructor(...a) { super(...a); window.__ctxs.push(this); } };
})();`;

export interface OpenOptions {
  user: UserDoc;
  path: string;
  flags?: string[];
  grant?: ("camera" | "microphone")[];
  deny?: boolean;
  sim?: Record<string, unknown>;
  width?: number;
  height?: number;
}

export interface Session {
  browser: Browser;
  page: Page;
  errors: string[];
}

export async function openBrowser(opts: OpenOptions): Promise<Session> {
  const flags = opts.flags ?? [];
  const args = [
    flags.find((f) => f.startsWith("--use-fake-device")) ?? "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    ...flags.filter((f) => !f.startsWith("--use-fake-device")),
  ];
  if (opts.deny) args.push("--deny-permission-prompts");
  else if (!opts.grant) args.push("--use-fake-ui-for-media-stream");

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args });
  if (opts.grant) await browser.defaultBrowserContext().overridePermissions(BASE, opts.grant);
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${(e as Error).message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  await page.evaluateOnNewDocument(instrument(opts.sim ?? {}));
  await page.setViewport({ width: opts.width ?? 1440, height: opts.height ?? 900 });

  // Real launch flow: signed token → HttpOnly cookie → redirect into the exam.
  const launch = `${BASE}/api/auth/launch?token=${tokenFor(opts.user)}&next=${encodeURIComponent(opts.path)}`;
  await page.goto(launch, { waitUntil: "networkidle2" });
  return { browser, page, errors };
}

export const card = (page: Page, id: string) =>
  page.$eval(`[data-check="${id}"]`, (el) => ({
    status: (el as HTMLElement).dataset.status,
    reason: (el as HTMLElement).dataset.reason ?? null,
    badge: el.querySelector("span.rounded-full")?.textContent?.trim(),
    text: (el as HTMLElement).innerText.replace(/\s+/g, " "),
  }));

export const waitStatus = (page: Page, id: string, statuses: string[], timeout = 20000) =>
  page.waitForFunction(
    (id, st) =>
      st.includes(
        (document.querySelector(`[data-check="${id}"]`) as HTMLElement | null)?.dataset.status ??
          "",
      ),
    { timeout, polling: 100 },
    id,
    statuses,
  );

export const buttonState = (page: Page, label: RegExp | string) =>
  page.evaluate(
    (src, flags) => {
      const re = new RegExp(src, flags);
      const b = [...document.querySelectorAll("button")].find((b) => re.test(b.textContent ?? ""));
      return b ? { disabled: b.disabled, text: b.textContent?.trim() } : null;
    },
    typeof label === "string" ? label : label.source,
    typeof label === "string" ? "" : label.flags,
  );

export const waitButton = (page: Page, text: string, enabled: boolean, timeout = 10000) =>
  page.waitForFunction(
    (t, en) => {
      const b = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(t));
      return !!b && b.disabled === !en;
    },
    { timeout, polling: 50 },
    text,
    enabled,
  );

export const click = (page: Page, text: string, scope = "body") =>
  page.evaluate(
    (t, s) => {
      const b = [...document.querySelector(s)!.querySelectorAll("button")].find(
        (b) => b.textContent?.includes(t) && !b.disabled,
      );
      if (!b) throw new Error(`No enabled button "${t}"`);
      b.click();
    },
    text,
    scope,
  );

export const waitText = (page: Page, text: string, timeout = 10000) =>
  page.waitForFunction((t) => document.body.innerText.includes(t), { timeout, polling: 100 }, text);

export const mediaReport = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __streams: MediaStream[]; __ctxs: AudioContext[] };
    return {
      streams: w.__streams.length,
      liveTracks: w.__streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === "live")
        .length,
      ctxs: w.__ctxs.map((c) => c.state),
    };
  });

// ─── Runner ──────────────────────────────────────────────────────────────────

export interface Result {
  name: string;
  pass: boolean;
  details?: string;
}
const results: Result[] = [];
const only = process.env.E2E_ONLY?.split(",");

export async function test(name: string, fn: () => Promise<string | void>) {
  if (only && !only.some((o) => name.startsWith(o))) return;
  try {
    const details = await fn();
    results.push({ name, pass: true, details: details ?? undefined });
    console.log(`PASS ${name}${details ? ` — ${details}` : ""}`);
  } catch (e) {
    results.push({ name, pass: false, details: (e as Error).message });
    console.log(`FAIL ${name} — ${(e as Error).message}`);
  }
}

export function summary() {
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  return passed === results.length;
}

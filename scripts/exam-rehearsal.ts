/**
 * Load rehearsal: N simulated candidates take the REHEARSAL exam at the same
 * time through the real public URL (tunnel included), using the same API calls
 * as the browser: invite → system check → instructions → start → paper →
 * save every answer → submit. Rehearsal candidates are removed afterwards.
 *
 *   npx tsx scripts/exam-rehearsal.ts https://<public-url> [--candidates 20] [--exam MERN-101-DRY]
 *
 * Never touches the real exam or real candidates.
 */
import { ObjectId } from "mongodb";
import { closeMongoClient, getDb } from "@/server/db/mongodb";
import {
  createInviteService,
  ensureInviteIndexes,
  INVITES_COLLECTION,
} from "@/server/invites/invite-service";
import { createExamRepository } from "@/server/repositories/exam-repository";

const [base, ...rest] = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : fallback;
};
if (!base?.startsWith("http")) {
  console.error("Usage: npx tsx scripts/exam-rehearsal.ts https://<public-url> [--candidates 20]");
  process.exit(1);
}
const COUNT = Number(flag("candidates", "20"));
const EXAM = flag("exam", "MERN-101-DRY");
if (!EXAM.endsWith("-DRY")) throw new Error("Rehearsals only run against a -DRY exam.");
const DOMAIN = "rehearsal.kproctor.test";

type Timing = { step: string; ms: number };

async function candidateRun(i: number, code: string, email: string, name: string) {
  const timings: Timing[] = [];
  let cookie = "";
  const call = async <T>(
    step: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> => {
    const started = Date.now();
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    timings.push({ step, ms: Date.now() - started });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const data = (await res.json().catch(() => null)) as T & { error?: { code: string } };
    if (!res.ok) throw new Error(`${step} → HTTP ${res.status} ${data?.error?.code ?? ""}`);
    return data;
  };

  const { redirectTo } = await call<{ redirectTo: string }>(
    "invite",
    "POST",
    "/api/invites/verify",
    {
      fullName: name,
      email,
      code,
    },
  );
  const examId = redirectTo.split("/").pop()!;
  const session = await call<{ attempt: { id: string } }>(
    "start attempt",
    "POST",
    `/api/exams/${examId}/attempts`,
    {},
  );
  const id = session.attempt.id;
  await call("system check", "POST", `/api/exam-attempts/${id}/system-check`, {
    results: { camera: "passed", microphone: "passed", speaker: "passed", network: "passed" },
  });
  await call("instructions", "POST", `/api/exam-attempts/${id}/instructions/acknowledge`, {});
  await call("start exam", "POST", `/api/exam-attempts/${id}/start-exam`, {});
  const paper = await call<{ questions: { id: string; options: { id: string }[] }[] }>(
    "paper",
    "GET",
    `/api/exam-attempts/${id}/paper`,
  );
  for (const q of paper.questions) {
    await call("visit", "POST", `/api/exam-attempts/${id}/answers/${q.id}`, { visited: true });
    const pick = q.options[(i + q.id.charCodeAt(q.id.length - 1)) % q.options.length].id;
    await call("answer", "POST", `/api/exam-attempts/${id}/answers/${q.id}`, {
      selectedOptionId: pick,
      expectedVersion: 0,
      requestId: `rehearsal-${i}-${q.id}`,
    });
  }
  const done = await call<{ attempt: { status: string } }>(
    "submit",
    "POST",
    `/api/exam-attempts/${id}/submit`,
    {},
  );
  return { attemptId: id, status: done.attempt.status, answered: paper.questions.length, timings };
}

const db = await getDb();
const cleanup = async () => {
  const users = await db
    .collection("users")
    .find({ email: new RegExp(`@${DOMAIN.replace(/\./g, "\\.")}$`) })
    .project({ _id: 1 })
    .toArray();
  const ids = users.map((u) => u._id as ObjectId);
  const attempts = await db
    .collection("examAttempts")
    .find({ candidateId: { $in: ids } })
    .project({ _id: 1 })
    .toArray();
  const aIds = attempts.map((a) => a._id as ObjectId);
  await Promise.all([
    db.collection("candidateAnswers").deleteMany({ attemptId: { $in: aIds } }),
    db.collection("proctoringEvents").deleteMany({ attemptId: { $in: aIds } }),
    db.collection("examSessions").deleteMany({ attemptId: { $in: aIds } }),
    db
      .collection("auditLogs")
      .deleteMany({ $or: [{ attemptId: { $in: aIds } }, { candidateId: { $in: ids } }] }),
    db.collection("examAttempts").deleteMany({ _id: { $in: aIds } }),
    db
      .collection(INVITES_COLLECTION)
      .deleteMany({ email: new RegExp(`@${DOMAIN.replace(/\./g, "\\.")}$`) }),
  ]);
  await db.collection("users").deleteMany({ _id: { $in: ids } });
};

try {
  await ensureInviteIndexes(db);
  const exam = await createExamRepository(db).findByRef(EXAM);
  if (!exam)
    throw new Error(`${EXAM} not found — run scripts/setup-mern-exam.ts --code ${EXAM} first.`);
  await cleanup();
  const service = createInviteService(db);
  const people = await Promise.all(
    Array.from({ length: COUNT }, async (_, i) => {
      const name = `Rehearsal Candidate ${i + 1}`;
      const email = `candidate${i + 1}@${DOMAIN}`;
      const { code } = await service.createInvite({
        examRef: EXAM,
        email,
        fullName: name,
        createdBy: "rehearsal",
      });
      return { i, code, email, name };
    }),
  );

  console.log(`Running ${COUNT} simultaneous candidates against ${base} …`);
  const started = Date.now();
  const results = await Promise.allSettled(
    people.map((p) => candidateRun(p.i, p.code, p.email, p.name)),
  );
  const wall = Date.now() - started;

  const ok = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<
    Awaited<ReturnType<typeof candidateRun>>
  >[];
  const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  const timings = ok.flatMap((r) => r.value.timings.map((t) => t.ms)).sort((a, b) => a - b);
  const pct = (p: number) =>
    timings[Math.min(timings.length - 1, Math.floor((p / 100) * timings.length))] ?? 0;

  // Verify against the database: every submitted attempt has all answers saved and exactly one submit audit.
  let consistent = 0;
  for (const r of ok) {
    const id = new ObjectId(r.value.attemptId);
    const [attempt, answers, audits] = await Promise.all([
      db.collection("examAttempts").findOne({ _id: id }),
      db
        .collection("candidateAnswers")
        .countDocuments({ attemptId: id, "selectedOptionIds.0": { $exists: true } }),
      db.collection("auditLogs").countDocuments({ attemptId: id, eventType: "EXAM_SUBMITTED" }),
    ]);
    if (attempt?.status === "SUBMITTED" && answers === r.value.answered && audits === 1)
      consistent += 1;
  }
  const ips = await db.collection("auditLogs").distinct("ipAddress", {
    eventType: "CANDIDATE_LAUNCHED",
    "metadata.method": "INVITE",
    candidateId: { $exists: true },
  });

  console.log(
    `\nCompleted: ${ok.length}/${COUNT} candidates submitted in ${(wall / 1000).toFixed(1)} s`,
  );
  console.log(
    `Requests: ${timings.length}, latency p50 ${pct(50)} ms · p95 ${pct(95)} ms · max ${timings.at(-1) ?? 0} ms`,
  );
  console.log(
    `Database check: ${consistent}/${ok.length} attempts SUBMITTED with every answer saved and one submit audit`,
  );
  console.log(
    `Client IPs recorded (should be your public IP, not 127.0.0.1/::1): ${ips.filter(Boolean).join(", ") || "none"}`,
  );
  for (const f of failed) console.log(`FAILED: ${(f.reason as Error).message}`);
  process.exitCode = failed.length || consistent !== ok.length ? 1 : 0;
} finally {
  await cleanup().catch(() => undefined);
  await closeMongoClient();
}

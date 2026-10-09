import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { normalizeInviteCode } from "@/types/invite";
import { startExamAttempt } from "../api/exam-api";
import { SESSION_COOKIE, verifyCandidateToken } from "../auth/candidate-auth";
import { getCollections, type ExamDoc } from "../db/collections";
import { closeMongoClient } from "../db/mongodb";
import { DomainError } from "../errors";
import { createCandidate, createExam, resetTestDb } from "../test/fixtures";
import { verifyInvite } from "./invite-api";
import {
  createInviteService,
  ensureInviteIndexes,
  INVITES_COLLECTION,
  type ExamInviteDoc,
} from "./invite-service";

let db: Db;
let exam: ExamDoc;
const ctx = { ipAddress: "198.51.100.7", userAgent: "vitest" };
const svc = () => createInviteService(db);

async function invite(
  overrides: { email?: string; fullName?: string; hours?: number; max?: number } = {},
) {
  return svc().createInvite({
    examRef: exam.examCode,
    email: overrides.email ?? "Ananya.Rao@Example.test",
    fullName: overrides.fullName ?? "Ananya  Rao",
    expiresInHours: overrides.hours,
    maxRedemptions: overrides.max,
    createdBy: "vitest",
  });
}

const redeem = (body: Record<string, unknown>) => svc().redeem(body, ctx);
const failure = async (body: Record<string, unknown>) => {
  const e = await redeem(body).then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(DomainError);
  return e as DomainError;
};

beforeEach(async () => {
  db = await resetTestDb();
  await ensureInviteIndexes(db);
  exam = await createExam(db, { examCode: "INV-201" });
});

afterAll(async () => {
  await (await resetTestDb()).dropDatabase();
  await closeMongoClient();
});

describe("invite creation", () => {
  it("returns a KP-XXXX-XXXX code once and stores only its keyed hash", async () => {
    const { code, invite: doc } = await invite();
    expect(code).toMatch(/^KP-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    const stored = await db.collection(INVITES_COLLECTION).findOne({});
    expect(JSON.stringify(stored)).not.toContain(code);
    expect(JSON.stringify(stored)).not.toContain(code.replace(/-/g, "").slice(2));
    expect(stored).toMatchObject({ email: "ananya.rao@example.test", fullName: "Ananya Rao" });
    expect(doc.expiresAt.getTime()).toBeLessThanOrEqual(exam.endAt.getTime());
  });
});

describe("invite redemption", () => {
  it("matching details open an exam-scoped session for a new external candidate", async () => {
    const { code } = await invite();
    const r = await redeem({
      fullName: " ananya rao ",
      email: "ANANYA.RAO@example.test ",
      code: code.toLowerCase(),
    });
    expect(r.redirectTo).toBe(`/exam/${exam._id.toHexString()}`);
    const payload = verifyCandidateToken(r.sessionToken)!;
    expect(payload.exm).toBe(exam._id.toHexString());

    const c = getCollections(db);
    const user = await c.users.findOne({
      _id: new (await import("mongodb")).ObjectId(payload.sub),
    });
    expect(user).toMatchObject({
      role: "candidate",
      name: "Ananya Rao",
      email: "ananya.rao@example.test",
    });
    const audit = await c.auditLogs.findOne({ eventType: "CANDIDATE_LAUNCHED" });
    expect(audit!.metadata).toMatchObject({ method: "INVITE" });

    // Re-entering (e.g. after closing the browser) reuses the same candidate.
    const again = await redeem({ fullName: "Ananya Rao", email: "ananya.rao@example.test", code });
    expect(verifyCandidateToken(again.sessionToken)!.sub).toBe(payload.sub);
    expect(await c.users.countDocuments({ email: "ananya.rao@example.test" })).toBe(1);
  });

  it("accepts the code typed without dashes or prefix", async () => {
    const { code } = await invite();
    expect(normalizeInviteCode(code.slice(3).replace("-", " "))).toBe(code);
    await expect(
      redeem({
        fullName: "Ananya Rao",
        email: "ananya.rao@example.test",
        code: code.slice(3).replace("-", ""),
      }),
    ).resolves.toBeTruthy();
  });

  it("gives one generic answer for a wrong code, email or name (no hint which)", async () => {
    const { code } = await invite();
    const good = { fullName: "Ananya Rao", email: "ananya.rao@example.test", code };
    const messages = new Set<string>();
    for (const body of [
      { ...good, code: "KP-AAAA-BBBB" },
      { ...good, email: "someone@example.test" },
      { ...good, fullName: "Someone Else" },
    ]) {
      const e = await failure(body);
      expect(e.status).toBe(403);
      messages.add(e.message);
    }
    expect(messages.size).toBe(1);
    const c = getCollections(db);
    expect(await c.users.countDocuments({})).toBe(0);
    const rejected = await c.auditLogs.find({ eventType: "LAUNCH_REJECTED" }).toArray();
    expect(rejected.map((a) => a.metadata.reason)).toEqual([
      "UNKNOWN_CODE",
      "DETAILS_MISMATCH",
      "DETAILS_MISMATCH",
    ]);
    expect(JSON.stringify(rejected)).not.toContain(code);
  });

  it("rejects malformed input with field-level validation", async () => {
    expect((await failure({ fullName: "", email: "a@b.co", code: "KP-AAAA-BBBB" })).status).toBe(
      422,
    );
    expect((await failure({ fullName: "A B", email: "nope", code: "KP-AAAA-BBBB" })).status).toBe(
      422,
    );
    expect((await failure({ fullName: "A B", email: "a@b.co", code: "123" })).status).toBe(422);
  });

  it("refuses expired, revoked and over-used invites", async () => {
    const c = db.collection<ExamInviteDoc>(INVITES_COLLECTION);
    const body = (code: string) => ({
      fullName: "Ananya Rao",
      email: "ananya.rao@example.test",
      code,
    });

    const expired = await invite();
    await c.updateOne(
      { _id: expired.invite._id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    expect((await failure(body(expired.code))).message).toMatch(/expired/);

    const revoked = await invite();
    await svc().revokeInvite(revoked.invite._id);
    expect((await failure(body(revoked.code))).message).toMatch(/no longer valid/);

    const once = await invite({ max: 1 });
    await redeem(body(once.code));
    expect((await failure(body(once.code))).message).toMatch(/too many times/);
  });

  it("only works inside the exam window and for published exams", async () => {
    exam = await createExam(db, {
      examCode: "INV-LATER",
      startAt: new Date(Date.now() + 3600_000),
    });
    const later = await invite();
    const e = await failure({
      fullName: "Ananya Rao",
      email: "ananya.rao@example.test",
      code: later.code,
    });
    expect(e.code).toBe("EXAM_NOT_ACTIVE");

    exam = await createExam(db, { examCode: "INV-DRAFT" });
    const draft = await invite();
    await getCollections(db).exams.updateOne({ _id: exam._id }, { $set: { status: "DRAFT" } });
    expect(
      (
        await failure({
          fullName: "Ananya Rao",
          email: "ananya.rao@example.test",
          code: draft.code,
        })
      ).code,
    ).toBe("EXAM_NOT_ACTIVE");
  });

  it("never takes over an existing account that uses the invited email", async () => {
    await createCandidate(db, { email: "ananya.rao@example.test", name: "LMS Student" });
    const { code } = await invite();
    const e = await failure({ fullName: "Ananya Rao", email: "ananya.rao@example.test", code });
    expect(e.status).toBe(403);
    expect(
      await getCollections(db).users.countDocuments({ email: "ananya.rao@example.test" }),
    ).toBe(1);
  });

  it("concurrent first redemptions create exactly one candidate", async () => {
    const { code } = await invite();
    const body = { fullName: "Ananya Rao", email: "ananya.rao@example.test", code };
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => redeem(body)));
    const ok = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<{
      sessionToken: string;
    }>[];
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const subs = new Set(ok.map((r) => verifyCandidateToken(r.value.sessionToken)!.sub));
    expect(subs.size).toBe(1);
    expect(
      await getCollections(db).users.countDocuments({ email: "ananya.rao@example.test" }),
    ).toBe(1);
  });

  it("rate-limits repeated attempts per email", async () => {
    await invite();
    const body = { fullName: "Ananya Rao", email: "ananya.rao@example.test", code: "KP-AAAA-BBBB" };
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await failure(body)).status);
    expect(statuses.slice(0, 10).every((s) => s === 403)).toBe(true);
    expect(statuses.slice(10).every((s) => s === 429)).toBe(true);
  });
});

describe("POST /api/invites/verify", () => {
  const request = (body: unknown, origin?: string) =>
    new Request("http://localhost:3100/api/invites/verify", {
      method: "POST",
      headers: {
        host: "localhost:3100",
        "content-type": "application/json",
        ...(origin ? { origin } : {}),
      },
      body: JSON.stringify(body),
    });

  it("sets the HttpOnly session cookie (never in the body) and the session is scoped to that exam", async () => {
    const { code } = await invite();
    const res = await verifyInvite(
      request({ fullName: "Ananya Rao", email: "ananya.rao@example.test", code }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body)).toEqual(["redirectTo"]);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=`));
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");

    const session = cookie.split(";")[0];
    const other = await createExam(db, { examCode: "OTHER-EXAM" });
    const start = (target: ExamDoc) =>
      startExamAttempt(
        new Request(`http://localhost:3100/api/exams/${target._id}/attempts`, {
          method: "POST",
          headers: { cookie: session, host: "localhost:3100" },
        }),
        target._id.toHexString(),
      );
    expect((await start(other)).status).toBe(403);
    expect((await start(exam)).status).toBe(201);
  });

  it("rejects cross-origin requests", async () => {
    const { code } = await invite();
    const res = await verifyInvite(
      request(
        { fullName: "Ananya Rao", email: "ananya.rao@example.test", code },
        "https://evil.test",
      ),
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

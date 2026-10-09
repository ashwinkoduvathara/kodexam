import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateKeyPairSync, createHmac, randomBytes, sign, type KeyObject } from "node:crypto";
import type { Db } from "mongodb";
import { createKProctorLaunch } from "../../../integrations/lms/kproctor-launch";
import { getCollections, USER_ROLE, type ExamDoc } from "../db/collections";
import { closeMongoClient } from "../db/mongodb";
import { startExamAttempt } from "../api/exam-api";
import { createCandidate, createExam, resetTestDb } from "../test/fixtures";
import { SESSION_COOKIE, verifyCandidateToken } from "./candidate-auth";
import { handleLaunch } from "./launch";
import { getLaunchConfig, resetLaunchConfigForTests, type LaunchConfig } from "./launch-config";
import { processLmsLaunch } from "./lms-launch";

const ISSUER = "https://lms.kodeversity.test";
let db: Db;
let exam: ExamDoc;
let keys: { publicKey: KeyObject; privateKey: KeyObject };
let config: LaunchConfig;
const ctx = { ipAddress: "203.0.113.9", userAgent: "vitest" };

const b64 = (v: unknown) =>
  Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");

/** Hand-rolled token, for malformed variants the reference signer would never produce. */
function rawToken(
  claims: Record<string, unknown>,
  {
    header = { alg: "EdDSA", typ: "JWT" },
    key = keys.privateKey,
  }: { header?: object; key?: KeyObject } = {},
) {
  const head = b64(header);
  const body = b64(claims);
  return `${head}.${body}.${sign(null, Buffer.from(`${head}.${body}`), key).toString("base64url")}`;
}

function claims(overrides: Record<string, unknown> = {}) {
  const iat = Math.floor(Date.now() / 1000);
  return {
    iss: ISSUER,
    aud: "kproctor-launch",
    sub: "lms-user-42",
    jti: randomBytes(18).toString("base64url"),
    iat,
    exp: iat + 60,
    exam: exam.examCode,
    name: "Meera Iyer",
    email: "meera@example.test",
    ...overrides,
  };
}

const launch = (token: string | null, secure = true) =>
  processLmsLaunch(db, token, { ctx, secure, config });

const goodToken = (overrides: Partial<Parameters<typeof createKProctorLaunch>[0]> = {}) =>
  createKProctorLaunch({
    privateKey: keys.privateKey,
    issuer: ISSUER,
    kproctorUrl: "https://exam.test",
    lmsUserId: "lms-user-42",
    exam: exam.examCode,
    name: "Meera Iyer",
    email: "meera@example.test",
    ...overrides,
  }).token;

const reason = async (token: string | null) => {
  const r = await launch(token);
  return r.ok ? "OK" : r.reason;
};

beforeEach(async () => {
  db = await resetTestDb();
  exam = await createExam(db, { examCode: "LMS-101" });
  keys = generateKeyPairSync("ed25519");
  config = {
    production: false,
    lmsPublicKey: keys.publicKey,
    lmsIssuer: ISSUER,
    audience: "kproctor-launch",
    maxLifetimeSeconds: 120,
    clockSkewSeconds: 30,
    sessionTtlSeconds: 4 * 3600,
    allowDevLaunch: true,
  };
});

afterAll(async () => {
  await (await resetTestDb()).dropDatabase();
  await closeMongoClient();
});

describe("LMS launch: valid tokens", () => {
  it("exchanges a valid token for a secure, exam-scoped session cookie", async () => {
    const result = await launch(goodToken());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.location).toBe(`/exam/${exam._id.toHexString()}`);
    expect(result.cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=`));
    for (const flag of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"]) {
      expect(result.cookie).toContain(flag);
    }
    const session = decodeURIComponent(result.cookie.split(";")[0].split("=")[1]);
    const payload = verifyCandidateToken(session)!;
    expect(payload.exm).toBe(exam._id.toHexString());
    expect(payload.exp - payload.iat).toBe(4 * 3600);

    const c = getCollections(db);
    const user = await c.users.findOne({ lmsUserId: "lms-user-42" });
    expect(user).toMatchObject({ role: "candidate", name: "Meera Iyer", status: "ACTIVE" });
    expect(await c.auditLogs.countDocuments({ eventType: "CANDIDATE_LAUNCHED" })).toBe(1);
    // A later launch reuses the same candidate.
    expect((await launch(goodToken())).ok).toBe(true);
    expect(await c.users.countDocuments({ lmsUserId: "lms-user-42" })).toBe(1);
  });

  it("the scoped session can't open or start a different exam", async () => {
    const result = await launch(goodToken());
    if (!result.ok) throw new Error("launch failed");
    const cookie = result.cookie.split(";")[0];
    const other = await createExam(db, { examCode: "OTHER-9" });
    const attempt = (target: ExamDoc) =>
      startExamAttempt(
        new Request(`http://localhost:3100/api/exams/${target._id}/attempts`, {
          method: "POST",
          headers: { cookie, host: "localhost:3100" },
        }),
        target._id.toHexString(),
      );
    expect((await attempt(other)).status).toBe(403);
    expect((await attempt(exam)).status).toBe(201);
  });
});

describe("LMS launch: rejected tokens", () => {
  it("is single-use: a replay is rejected, and concurrent reuse succeeds exactly once", async () => {
    const token = goodToken();
    expect(await reason(token)).toBe("OK");
    expect(await reason(token)).toBe("REPLAYED");
    const another = goodToken();
    const results = await Promise.all(Array.from({ length: 5 }, () => launch(another)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === "REPLAYED")).toHaveLength(4);
  });

  it("rejects bad signatures, tampering and algorithm confusion", async () => {
    const otherKey = generateKeyPairSync("ed25519").privateKey;
    expect(await reason(rawToken(claims(), { key: otherKey }))).toBe("BAD_SIGNATURE");
    const [h, , s] = goodToken().split(".");
    expect(await reason(`${h}.${b64(claims({ sub: "someone-else" }))}.${s}`)).toBe("BAD_SIGNATURE");
    const none = `${b64({ alg: "none" })}.${b64(claims())}.`;
    expect(await reason(none)).toBe("BAD_ALGORITHM");
    const hsHead = b64({ alg: "HS256", typ: "JWT" });
    const hsBody = b64(claims());
    const hs = createHmac("sha256", "guess").update(`${hsHead}.${hsBody}`).digest("base64url");
    expect(await reason(`${hsHead}.${hsBody}.${hs}`)).toBe("BAD_ALGORITHM");
    expect(await reason("not-a-token")).toBe("MALFORMED");
    expect(await reason(null)).toBe("MALFORMED");
  });

  it("validates issuer, audience, expiry, issue time, lifetime and token id", async () => {
    const now = Math.floor(Date.now() / 1000);
    expect(await reason(rawToken(claims({ iss: "https://evil.test" })))).toBe("BAD_ISSUER");
    expect(await reason(rawToken(claims({ aud: "someone-else" })))).toBe("BAD_AUDIENCE");
    expect(await reason(rawToken(claims({ iat: now - 90, exp: now - 1 })))).toBe("EXPIRED");
    expect(await reason(rawToken(claims({ iat: now + 300, exp: now + 360 })))).toBe(
      "NOT_YET_VALID",
    );
    expect(await reason(rawToken(claims({ iat: now, exp: now + 3600 })))).toBe("LIFETIME_TOO_LONG");
    expect(await reason(rawToken(claims({ jti: undefined })))).toBe("BAD_CLAIMS");
    expect(await reason(rawToken(claims({ jti: "short" })))).toBe("BAD_CLAIMS");
    expect(await reason(rawToken(claims({ exam: undefined })))).toBe("BAD_CLAIMS");
  });

  it("refuses unauthorized exam launches", async () => {
    expect(await reason(goodToken({ exam: "NO-SUCH-EXAM" }))).toBe("EXAM_NOT_AVAILABLE");
    await createExam(db, { examCode: "DRAFT-1", status: "DRAFT" });
    expect(await reason(goodToken({ exam: "DRAFT-1" }))).toBe("EXAM_NOT_AVAILABLE");
    await createExam(db, { examCode: "CLOSED-1", endAt: new Date(Date.now() - 1000) });
    expect(await reason(goodToken({ exam: "CLOSED-1" }))).toBe("EXAM_NOT_AVAILABLE");
    expect(await getCollections(db).users.countDocuments({ lmsUserId: "lms-user-42" })).toBe(0);
  });

  it("refuses disabled or non-candidate accounts and never auto-links by email", async () => {
    const c = getCollections(db);
    await createCandidate(db, { lmsUserId: "disabled-1", status: "DISABLED", name: "D" });
    expect(await reason(goodToken({ lmsUserId: "disabled-1" }))).toBe("CANDIDATE_NOT_ALLOWED");
    await createCandidate(db, { lmsUserId: "staff-1", role: USER_ROLE.PROCTOR, name: "S" });
    expect(await reason(goodToken({ lmsUserId: "staff-1" }))).toBe("CANDIDATE_NOT_ALLOWED");
    await createCandidate(db, { email: "taken@example.test", name: "Existing" });
    expect(await reason(goodToken({ lmsUserId: "new-1", email: "taken@example.test" }))).toBe(
      "IDENTITY_CONFLICT",
    );
    expect(await c.users.countDocuments({ lmsUserId: "new-1" })).toBe(0);
  });

  it("is disabled until a public key and issuer are configured", async () => {
    config = { ...config, lmsPublicKey: null };
    expect(await reason(goodToken())).toBe("DISABLED");
  });

  it("audits rejections by reason only, never the token", async () => {
    const token = rawToken(claims({ iss: "https://evil.test" }));
    await launch(token);
    const audits = await getCollections(db)
      .auditLogs.find({ eventType: "LAUNCH_REJECTED" })
      .toArray();
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata).toEqual({ reason: "BAD_ISSUER" });
    expect(JSON.stringify(audits)).not.toContain(token.split(".")[2]);
  });
});

describe("development launch link", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    resetLaunchConfigForTests();
  });

  const devLaunch = async (cookieSecure: boolean) => {
    const candidate = await createCandidate(db);
    const { signCandidateToken } = await import("./candidate-auth");
    const token = signCandidateToken(candidate._id.toHexString());
    const res = handleLaunch(
      new Request(`http://localhost:3100/api/auth/launch?token=${token}&next=/exam/x`),
    );
    const cookie = res.headers.get("set-cookie") ?? "";
    return {
      location: res.headers.get("location"),
      cookie,
      secure: cookie.includes("Secure") === cookieSecure,
    };
  };

  it("still works in development", async () => {
    resetLaunchConfigForTests();
    expect(getLaunchConfig().allowDevLaunch).toBe(true);
    const r = await devLaunch(false);
    expect(r.location).toBe("/exam/x");
    expect(r.cookie).toContain("HttpOnly");
  });

  it("is refused in production unless explicitly enabled (and then sets a Secure cookie)", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.KPROCTOR_ALLOW_DEV_LAUNCH;
    resetLaunchConfigForTests();
    expect((await devLaunch(false)).location).toBe("/?launch=invalid");

    process.env.KPROCTOR_ALLOW_DEV_LAUNCH = "true";
    resetLaunchConfigForTests();
    const r = await devLaunch(true);
    expect(r.location).toBe("/exam/x");
    expect(r.secure).toBe(true);
  });
});

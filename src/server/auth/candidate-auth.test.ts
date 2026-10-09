import { describe, expect, it } from "vitest";
import { authenticateCandidate, signCandidateToken, verifyCandidateToken } from "./candidate-auth";
import { safeNextPath } from "./launch";

const SECRET = "unit-test-secret-unit-test-secret-1234";
const ID = "6ac7828846a87ca91190d096";

describe("candidate tokens", () => {
  it("round-trips a valid token", () => {
    const token = signCandidateToken(ID, { secret: SECRET });
    expect(verifyCandidateToken(token, { secret: SECRET })?.sub).toBe(ID);
  });

  it("rejects tampered, expired and foreign tokens", () => {
    const token = signCandidateToken(ID, { secret: SECRET });
    const [h, , s] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ sub: "ffffffffffffffffffffffff", aud: "kproctor", iat: 0, exp: 9e9 }),
    ).toString("base64url");
    expect(verifyCandidateToken(`${h}.${forged}.${s}`, { secret: SECRET })).toBeNull();
    expect(verifyCandidateToken(token, { secret: "another-secret-another-secret-123" })).toBeNull();
    const expired = signCandidateToken(ID, {
      secret: SECRET,
      ttlSeconds: 60,
      now: Date.now() - 120_000,
    });
    expect(verifyCandidateToken(expired, { secret: SECRET })).toBeNull();
    expect(verifyCandidateToken("not-a-token", { secret: SECRET })).toBeNull();
  });

  it("derives the candidate from the cookie, never from the request body", () => {
    const token = signCandidateToken(ID);
    const req = new Request("http://localhost/api/x", {
      method: "POST",
      headers: { cookie: `other=1; kp_session=${token}` },
      body: JSON.stringify({ candidateId: "ffffffffffffffffffffffff" }),
    });
    expect(authenticateCandidate(req).toHexString()).toBe(ID);
    expect(() => authenticateCandidate(new Request("http://localhost/"))).toThrow();
  });
});

describe("safeNextPath", () => {
  it.each([
    ["/exam/abc", "/exam/abc"],
    ["//evil.com", "/"],
    ["https://evil.com", "/"],
    ["/\\evil.com", "/"],
    [null, "/"],
  ])("%s → %s", (input, expected) => expect(safeNextPath(input)).toBe(expected));
});

import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { buildContentSecurityPolicy, securityHeaders } from "@/lib/security-headers";
import { exeBytes, fakeJpeg, fakePdf, fakePng, htmlBytes } from "../test/identity-fixtures";
import {
  createLocalKeyProvider,
  decryptEnvelope,
  deriveAccessSigningKey,
  encryptEnvelope,
  sha256Hex,
  signAccessToken,
  verifyAccessToken,
} from "./crypto";
import { imageDimensions, sniffFileType, validateDocument, validatePhoto } from "./file-validation";
import { createClamAvScanner } from "./malware-scanner";
import { canTransition } from "./state-machine";

const keys = createLocalKeyProvider(Buffer.alloc(32, 1));

describe("envelope encryption", () => {
  it("round-trips and binds ciphertext to its object key", () => {
    const data = new Uint8Array(Buffer.from("government id image bytes"));
    const sealed = encryptEnvelope(data, keys, "identity/document/a", "image/png");
    expect(sealed.toString("latin1")).not.toContain("government id");
    expect(decryptEnvelope(sealed, keys, "identity/document/a").plaintext.toString()).toBe(
      "government id image bytes",
    );
    // Same ciphertext presented as another object → authentication fails.
    expect(() => decryptEnvelope(sealed, keys, "identity/document/b")).toThrow();
  });

  it("detects tampering and wrong keys", () => {
    const sealed = encryptEnvelope(new Uint8Array([1, 2, 3, 4]), keys, "k", "x");
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => decryptEnvelope(tampered, keys, "k")).toThrow();
    expect(() =>
      decryptEnvelope(sealed, createLocalKeyProvider(Buffer.alloc(32, 2)), "k"),
    ).toThrow();
  });

  it("signs access tokens that expire and can't be forged", () => {
    const key = deriveAccessSigningKey(Buffer.alloc(32, 1));
    const token = signAccessToken({ r: "local:x", exp: 2_000, h: "abc", ct: "image/png" }, key);
    expect(verifyAccessToken(token, key, 1_000)?.r).toBe("local:x");
    expect(verifyAccessToken(token, key, 2_000)).toBeNull(); // expired
    expect(verifyAccessToken(token, deriveAccessSigningKey(Buffer.alloc(32, 9)), 1_000)).toBeNull();
    const [body] = token.split(".");
    expect(verifyAccessToken(`${body}.AAAA`, key, 1_000)).toBeNull();
  });

  it("hashes with SHA-256", () => {
    expect(sha256Hex(new Uint8Array(Buffer.from("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("file validation", () => {
  it("identifies files by signature, not by name", () => {
    expect(sniffFileType(fakeJpeg())).toBe("JPEG");
    expect(sniffFileType(fakePng())).toBe("PNG");
    expect(sniffFileType(fakePdf())).toBe("PDF");
    expect(sniffFileType(exeBytes())).toBeNull();
    expect(sniffFileType(htmlBytes())).toBeNull();
  });

  it("reads image dimensions", () => {
    expect(imageDimensions(fakeJpeg(800, 600), "JPEG")).toEqual({ width: 800, height: 600 });
    expect(imageDimensions(fakePng(1200, 900), "PNG")).toEqual({ width: 1200, height: 900 });
  });

  it("requires extension, MIME and signature to agree", () => {
    expect(
      validateDocument({ bytes: fakePng(), declaredMime: "image/png", declaredExtension: "png" })
        .fileType,
    ).toBe("PNG");
    expect(() =>
      validateDocument({ bytes: fakePng(), declaredMime: "image/png", declaredExtension: "jpg" }),
    ).toThrow();
    expect(() =>
      validateDocument({ bytes: fakePng(), declaredMime: "image/jpeg", declaredExtension: "jpg" }),
    ).toThrow();
    expect(() =>
      validateDocument({ bytes: fakePng(), declaredMime: null, declaredExtension: null }),
    ).toThrow();
  });

  it("rejects tiny images and non-JPEG photos", () => {
    expect(() =>
      validateDocument({
        bytes: fakePng(100, 80),
        declaredMime: "image/png",
        declaredExtension: "png",
      }),
    ).toThrow();
    expect(() => validatePhoto(fakePng())).toThrow();
    expect(() => validatePhoto(fakeJpeg(200, 150))).toThrow();
    expect(validatePhoto(fakeJpeg(1280, 720))).toEqual({ width: 1280, height: 720 });
  });
});

describe("state machine", () => {
  it("only the server's actors can make each transition", () => {
    expect(canTransition("DOCUMENT_UPLOADED", "PROCESSING", "CANDIDATE")).toBe(true);
    expect(canTransition("PROCESSING", "VERIFIED", "CANDIDATE")).toBe(false);
    expect(canTransition("PROCESSING", "VERIFIED", "SYSTEM")).toBe(true);
    expect(canTransition("REVIEW_REQUIRED", "VERIFIED", "SYSTEM")).toBe(false);
    expect(canTransition("REVIEW_REQUIRED", "VERIFIED", "REVIEWER")).toBe(true);
    expect(canTransition("NOT_STARTED", "VERIFIED", "CANDIDATE")).toBe(false);
    expect(canTransition("VERIFIED", "FAILED", "REVIEWER")).toBe(false);
  });
});

describe("ClamAV client", () => {
  let server: Server | null = null;
  afterEach(() => server?.close());

  async function fakeClamd(reply: string) {
    server = createServer((socket) => {
      let received = Buffer.alloc(0);
      socket.on("data", (d) => {
        received = Buffer.concat([received, d]);
        if (received.subarray(-4).equals(Buffer.alloc(4))) socket.end(`${reply}\0`);
      });
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
    const port = (server!.address() as { port: number }).port;
    return createClamAvScanner({ host: "127.0.0.1", port, timeoutMs: 2000 });
  }

  it("reports clean, infected and error responses", async () => {
    expect(await (await fakeClamd("stream: OK")).scan(fakePng())).toEqual({ status: "CLEAN" });
    server!.close();
    expect(await (await fakeClamd("stream: Eicar-Signature FOUND")).scan(fakePng())).toEqual({
      status: "INFECTED",
      signature: "Eicar-Signature",
    });
    server!.close();
    expect(
      (await (await fakeClamd("INSTREAM size limit exceeded. ERROR")).scan(fakePng())).status,
    ).toBe("ERROR");
  });

  it("treats an unreachable daemon as an error (never as clean)", async () => {
    const scanner = createClamAvScanner({ host: "127.0.0.1", port: 1, timeoutMs: 500 });
    expect((await scanner.scan(fakePng())).status).toBe("ERROR");
  });
});

describe("security headers", () => {
  it("sets the baseline headers everywhere and CSP with a nonce in production", () => {
    const dev = securityHeaders({ nonce: "n1", enforceCsp: false, secure: false });
    expect(dev["x-content-type-options"]).toBe("nosniff");
    expect(dev["referrer-policy"]).toBe("no-referrer");
    expect(dev["permissions-policy"]).toContain("camera=(self)");
    expect(dev["content-security-policy"]).toBeUndefined();

    const prod = securityHeaders({ nonce: "n1", enforceCsp: true, secure: true });
    expect(prod["content-security-policy"]).toContain("script-src 'self' 'nonce-n1'");
    expect(prod["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(prod["strict-transport-security"]).toContain("max-age");
    expect(buildContentSecurityPolicy("x")).not.toContain("unsafe-eval");
  });
});

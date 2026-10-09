import "@tanstack/react-start/server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/** SHA-256 for integrity. Not a substitute for encryption. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Key-encryption-key provider. The local implementation wraps data keys with
 * a 32-byte master key from the environment (development only). A production
 * KMS-backed provider implements the same interface.
 */
export interface KeyProvider {
  keyId: string;
  wrap(dataKey: Buffer, aad: Buffer): { wrapped: Buffer; iv: Buffer; tag: Buffer };
  unwrap(wrapped: Buffer, iv: Buffer, tag: Buffer, aad: Buffer): Buffer;
}

export function createLocalKeyProvider(masterKey: Buffer): KeyProvider {
  if (masterKey.length !== 32) throw new Error("Master key must be 32 bytes");
  return {
    keyId: `local:${sha256Hex(masterKey).slice(0, 12)}`,
    wrap(dataKey, aad) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
      cipher.setAAD(aad);
      const wrapped = Buffer.concat([cipher.update(dataKey), cipher.final()]);
      return { wrapped, iv, tag: cipher.getAuthTag() };
    },
    unwrap(wrapped, iv, tag, aad) {
      const decipher = createDecipheriv("aes-256-gcm", masterKey, iv);
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(wrapped), decipher.final()]);
    },
  };
}

const MAGIC = Buffer.from("KPX1");

interface EnvelopeHeader {
  v: 1;
  keyId: string;
  wrappedKey: string;
  wrapIv: string;
  wrapTag: string;
  iv: string;
  tag: string;
  contentType: string;
  size: number;
}

/**
 * Envelope encryption: a fresh AES-256-GCM data key per object, wrapped by the
 * key provider. The object key is bound as AAD, so ciphertexts can't be swapped
 * between objects without detection.
 */
export function encryptEnvelope(
  plaintext: Uint8Array,
  keys: KeyProvider,
  objectKey: string,
  contentType: string,
): Buffer {
  const aad = Buffer.from(objectKey);
  const dataKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dataKey, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const wrap = keys.wrap(dataKey, aad);
  dataKey.fill(0);

  const header: EnvelopeHeader = {
    v: 1,
    keyId: keys.keyId,
    wrappedKey: wrap.wrapped.toString("base64"),
    wrapIv: wrap.iv.toString("base64"),
    wrapTag: wrap.tag.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    contentType,
    size: plaintext.byteLength,
  };
  const headerBytes = Buffer.from(JSON.stringify(header));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(headerBytes.length);
  return Buffer.concat([MAGIC, length, headerBytes, ciphertext]);
}

export function readEnvelopeHeader(file: Buffer): EnvelopeHeader {
  if (!file.subarray(0, 4).equals(MAGIC)) throw new Error("Not an encrypted object");
  const len = file.readUInt32BE(4);
  return JSON.parse(file.subarray(8, 8 + len).toString("utf8")) as EnvelopeHeader;
}

export function decryptEnvelope(file: Buffer, keys: KeyProvider, objectKey: string) {
  const header = readEnvelopeHeader(file);
  const ciphertext = file.subarray(8 + file.readUInt32BE(4));
  const aad = Buffer.from(objectKey);
  const dataKey = keys.unwrap(
    Buffer.from(header.wrappedKey, "base64"),
    Buffer.from(header.wrapIv, "base64"),
    Buffer.from(header.wrapTag, "base64"),
    aad,
  );
  const decipher = createDecipheriv("aes-256-gcm", dataKey, Buffer.from(header.iv, "base64"));
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(header.tag, "base64"));
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  dataKey.fill(0);
  return { plaintext, contentType: header.contentType };
}

// ─── Signed, short-lived access tokens (local storage provider) ──────────────

export interface AccessTokenPayload {
  /** Storage reference. */
  r: string;
  /** Expiry, epoch seconds. */
  exp: number;
  /** Expected SHA-256, verified when serving (end-to-end integrity). */
  h: string;
  ct: string;
}

/** Signing key derived from the master key — never the encryption key itself. */
export function deriveAccessSigningKey(masterKey: Buffer): Buffer {
  return Buffer.from(
    hkdfSync("sha256", masterKey, Buffer.alloc(0), "kproctor-object-access-v1", 32),
  );
}

export function signAccessToken(payload: AccessTokenPayload, key: Buffer): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", key).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyAccessToken(
  token: string,
  key: Buffer,
  nowSeconds = Math.floor(Date.now() / 1000),
): AccessTokenPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", key).update(body).digest();
  const provided = Buffer.from(sig, "base64url");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as AccessTokenPayload;
    if (typeof payload.exp !== "number" || payload.exp <= nowSeconds) return null;
    return payload;
  } catch {
    return null;
  }
}

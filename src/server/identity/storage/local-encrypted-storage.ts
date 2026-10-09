import "@tanstack/react-start/server-only";
import { mkdir, readFile, rm, stat, writeFile, rename } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  decryptEnvelope,
  deriveAccessSigningKey,
  encryptEnvelope,
  readEnvelopeHeader,
  sha256Hex,
  signAccessToken,
  verifyAccessToken,
  type KeyProvider,
} from "../crypto";
import { OBJECT_KEY_PATTERN, type IdentityDocumentStorage } from "./types";

/**
 * DEVELOPMENT storage: AES-256-GCM envelope-encrypted files in a private
 * directory outside the web root. Refused in production (see config.ts).
 *
 * Signed URLs point at /api/identity-objects/<token>; the token is an HMAC
 * (key derived from the master key) carrying the reference, expiry and the
 * expected SHA-256, which is re-checked after decryption.
 */
export function createLocalEncryptedStorage(options: {
  dir: string;
  keys: KeyProvider;
  masterKey: Buffer;
}): IdentityDocumentStorage & {
  serve(token: string): Promise<{ body: Buffer; contentType: string } | null>;
} {
  const root = resolve(options.dir);
  const signingKey = deriveAccessSigningKey(options.masterKey);

  const keyOf = (reference: string) => {
    const key = reference.startsWith("local:") ? reference.slice(6) : "";
    if (!OBJECT_KEY_PATTERN.test(key)) throw new Error("Invalid object reference");
    return key;
  };
  const pathOf = (key: string) => {
    const path = resolve(join(root, `${key}.enc`));
    if (!path.startsWith(root)) throw new Error("Invalid object path");
    return path;
  };

  const storage = {
    provider: "local" as const,

    async upload({
      key,
      body,
      contentType,
    }: {
      key: string;
      body: Uint8Array;
      contentType: string;
    }) {
      if (!OBJECT_KEY_PATTERN.test(key)) throw new Error("Invalid object key");
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const tmp = `${path}.tmp`;
      await writeFile(tmp, encryptEnvelope(body, options.keys, key, contentType), { mode: 0o600 });
      await rename(tmp, path);
      return { reference: `local:${key}` };
    },

    async getTemporaryAccess(
      reference: string,
      {
        ttlSeconds,
        contentType,
        sha256,
      }: { ttlSeconds: number; contentType: string; sha256: string },
    ) {
      keyOf(reference);
      const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
      const token = signAccessToken({ r: reference, exp, h: sha256, ct: contentType }, signingKey);
      return { url: `/api/identity-objects/${token}`, expiresAt: new Date(exp * 1000) };
    },

    async delete(reference: string) {
      await rm(pathOf(keyOf(reference)), { force: true });
    },

    async getMetadata(reference: string) {
      try {
        const path = pathOf(keyOf(reference));
        await stat(path);
        const header = readEnvelopeHeader(await readFile(path));
        return {
          size: header.size,
          contentType: header.contentType,
          encrypted: true,
          provider: "local",
        };
      } catch {
        return null;
      }
    },

    async read(reference: string) {
      const key = keyOf(reference);
      return decryptEnvelope(await readFile(pathOf(key)), options.keys, key).plaintext;
    },

    /** Resolves a signed token to the decrypted object, or null if invalid/expired/tampered. */
    async serve(token: string) {
      const payload = verifyAccessToken(token, signingKey);
      if (!payload) return null;
      try {
        const key = keyOf(payload.r);
        const { plaintext, contentType } = decryptEnvelope(
          await readFile(pathOf(key)),
          options.keys,
          key,
        );
        if (sha256Hex(plaintext) !== payload.h) return null; // integrity check
        return { body: plaintext, contentType };
      } catch {
        return null;
      }
    },
  };
  return storage;
}

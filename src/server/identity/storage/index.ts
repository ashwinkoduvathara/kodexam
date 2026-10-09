import "@tanstack/react-start/server-only";
import { getIdentityConfig } from "../config";
import { createLocalKeyProvider } from "../crypto";
import { createLocalEncryptedStorage } from "./local-encrypted-storage";
import { createS3Storage } from "./s3-storage";
import type { IdentityDocumentStorage } from "./types";

type LocalStorage = ReturnType<typeof createLocalEncryptedStorage>;
let instance: IdentityDocumentStorage | null = null;

/** The configured provider. Production configuration refuses local storage. */
export function getIdentityStorage(): IdentityDocumentStorage {
  if (instance) return instance;
  const config = getIdentityConfig();
  if (config.storage === "s3") {
    instance = createS3Storage(config.s3!);
  } else {
    instance = createLocalEncryptedStorage({
      dir: config.localDir,
      keys: createLocalKeyProvider(config.masterKey!),
      masterKey: config.masterKey!,
    });
  }
  return instance;
}

/** Only the local provider serves objects through the app (S3 serves presigned URLs itself). */
export function getLocalObjectServer(): LocalStorage | null {
  const storage = getIdentityStorage();
  return storage.provider === "local" ? (storage as LocalStorage) : null;
}

export function setIdentityStorageForTests(storage: IdentityDocumentStorage | null) {
  instance = storage;
}

export type { IdentityDocumentStorage } from "./types";

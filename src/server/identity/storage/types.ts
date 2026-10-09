import "@tanstack/react-start/server-only";

/**
 * Private storage for identity documents and verification photos.
 *
 * Contract every provider must meet:
 * - objects are never publicly readable or listable
 * - objects are encrypted at rest
 * - access is only via short-lived signed URLs, never stored anywhere
 * - object keys contain no personal data (random UUIDs only)
 */
export interface StoredObjectMetadata {
  size: number;
  contentType: string;
  encrypted: boolean;
  provider: string;
}

export interface IdentityDocumentStorage {
  readonly provider: "local" | "s3";
  upload(input: {
    key: string;
    body: Uint8Array;
    contentType: string;
  }): Promise<{ reference: string }>;
  /** Short-lived URL for an authorised viewer. `sha256` lets the provider verify integrity. */
  getTemporaryAccess(
    reference: string,
    options: { ttlSeconds: number; contentType: string; sha256: string },
  ): Promise<{ url: string; expiresAt: Date }>;
  delete(reference: string): Promise<void>;
  getMetadata(reference: string): Promise<StoredObjectMetadata | null>;
  /** Server-side read for automated checks (malware scan, verification provider). */
  read(reference: string): Promise<Uint8Array>;
}

/** Object keys are random and carry no candidate information. */
export function newObjectKey(kind: "photo" | "document"): string {
  return `identity/${kind}/${crypto.randomUUID()}`;
}

export const OBJECT_KEY_PATTERN = /^identity\/(photo|document)\/[0-9a-f-]{36}$/;

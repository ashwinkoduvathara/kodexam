import "@tanstack/react-start/server-only";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { OBJECT_KEY_PATTERN, type IdentityDocumentStorage } from "./types";

/**
 * PRODUCTION storage: S3-compatible private bucket with server-side
 * encryption using a managed KMS key (SSE-KMS).
 *
 * Bucket requirements (enforced in infrastructure, not by this code):
 * - Block Public Access fully enabled; Object Ownership "bucket owner enforced" (no ACLs)
 * - Default encryption SSE-KMS with a customer-managed key; key policy limited to this service
 * - No public bucket policy, no listing for the app role beyond what it needs
 * - Versioning + lifecycle rules aligned with the retention policy
 *
 * Credentials come from the runtime's IAM role / standard AWS credential chain —
 * never from source code or the database.
 */
export function createS3Storage(options: {
  bucket: string;
  region: string;
  endpoint?: string;
  kmsKeyId?: string;
  forcePathStyle?: boolean;
  client?: S3Client;
}): IdentityDocumentStorage {
  const client =
    options.client ??
    new S3Client({
      region: options.region,
      endpoint: options.endpoint,
      forcePathStyle: options.forcePathStyle,
    });

  const keyOf = (reference: string) => {
    const key = reference.startsWith("s3:") ? reference.slice(3) : "";
    if (!OBJECT_KEY_PATTERN.test(key)) throw new Error("Invalid object reference");
    return key;
  };

  return {
    provider: "s3",

    async upload({ key, body, contentType }) {
      if (!OBJECT_KEY_PATTERN.test(key)) throw new Error("Invalid object key");
      await client.send(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ServerSideEncryption: "aws:kms",
          SSEKMSKeyId: options.kmsKeyId,
          CacheControl: "no-store",
          // No ACL is ever set: objects are private to the bucket owner.
        }),
      );
      return { reference: `s3:${key}` };
    },

    async getTemporaryAccess(reference, { ttlSeconds, contentType }) {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: options.bucket,
          Key: keyOf(reference),
          ResponseContentType: contentType,
          ResponseCacheControl: "no-store",
          ResponseContentDisposition: "inline",
        }),
        { expiresIn: ttlSeconds },
      );
      return { url, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
    },

    async delete(reference) {
      await client.send(new DeleteObjectCommand({ Bucket: options.bucket, Key: keyOf(reference) }));
    },

    async getMetadata(reference) {
      try {
        const head = await client.send(
          new HeadObjectCommand({ Bucket: options.bucket, Key: keyOf(reference) }),
        );
        return {
          size: head.ContentLength ?? 0,
          contentType: head.ContentType ?? "application/octet-stream",
          encrypted: head.ServerSideEncryption === "aws:kms",
          provider: "s3",
        };
      } catch {
        return null;
      }
    },

    async read(reference) {
      const res = await client.send(
        new GetObjectCommand({ Bucket: options.bucket, Key: keyOf(reference) }),
      );
      return new Uint8Array(await res.Body!.transformToByteArray());
    },
  };
}

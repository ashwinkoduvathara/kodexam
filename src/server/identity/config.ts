import "@tanstack/react-start/server-only";
import { loadServerEnv, ServerConfigError } from "../env";

/**
 * Identity verification configuration. Every security-relevant limit is
 * configurable; production refuses unsafe combinations instead of degrading.
 */

const MB = 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

export type StorageProviderName = "local" | "s3";
export type ScannerName = "none" | "clamav";

export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

export interface IdentityConfig {
  production: boolean;
  storage: StorageProviderName;
  localDir: string;
  /** 32-byte key for local envelope encryption. Development only. */
  masterKey: Buffer | null;
  s3: {
    bucket: string;
    region: string;
    endpoint?: string;
    kmsKeyId?: string;
    forcePathStyle: boolean;
  } | null;
  scanner: ScannerName;
  clamav: { host: string; port: number; timeoutMs: number };
  maxDocumentBytes: number;
  maxPhotoBytes: number;
  signedUrlTtlSeconds: number;
  documentRetentionMs: number;
  photoRetentionMs: number;
  auditRetentionDays: number | null;
  maxRetries: number;
  /** PROCESSING older than this is recovered to REVIEW_REQUIRED. */
  processingTimeoutMs: number;
  rateLimits: {
    capture: RateLimitRule;
    document: RateLimitRule;
    verify: RateLimitRule;
    retry: RateLimitRule;
    status: RateLimitRule;
    reviewAccess: RateLimitRule;
  };
}

function num(name: string, fallback: number, { min = 0 }: { min?: number } = {}): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min) throw new ServerConfigError(name);
  return value;
}

let cached: IdentityConfig | null = null;

export function getIdentityConfig(): IdentityConfig {
  if (cached) return cached;
  loadServerEnv();
  const env = process.env;
  const production = env.NODE_ENV === "production";

  const storage = (env.KPROCTOR_IDENTITY_STORAGE ?? "local") as StorageProviderName;
  if (storage !== "local" && storage !== "s3")
    throw new ServerConfigError("KPROCTOR_IDENTITY_STORAGE");

  const scanner = (env.KPROCTOR_MALWARE_SCANNER ?? "none") as ScannerName;
  if (scanner !== "none" && scanner !== "clamav")
    throw new ServerConfigError("KPROCTOR_MALWARE_SCANNER");

  let masterKey: Buffer | null = null;
  if (env.KPROCTOR_IDENTITY_MASTER_KEY) {
    masterKey = Buffer.from(env.KPROCTOR_IDENTITY_MASTER_KEY, "base64");
    if (masterKey.length !== 32) throw new ServerConfigError("KPROCTOR_IDENTITY_MASTER_KEY");
  }
  if (storage === "local" && !masterKey)
    throw new ServerConfigError("KPROCTOR_IDENTITY_MASTER_KEY");

  const s3 =
    storage === "s3"
      ? {
          bucket: env.KPROCTOR_S3_BUCKET ?? "",
          region: env.KPROCTOR_S3_REGION ?? "",
          endpoint: env.KPROCTOR_S3_ENDPOINT || undefined,
          kmsKeyId: env.KPROCTOR_S3_KMS_KEY_ID || undefined,
          forcePathStyle: env.KPROCTOR_S3_FORCE_PATH_STYLE === "true",
        }
      : null;
  if (s3 && (!s3.bucket || !s3.region)) throw new ServerConfigError("KPROCTOR_S3_BUCKET/REGION");

  // Production safety: no development storage, no unscanned documents, KMS-encrypted objects.
  if (production) {
    if (storage === "local")
      throw new ServerConfigError("KPROCTOR_IDENTITY_STORAGE (local is development-only)");
    if (scanner === "none")
      throw new ServerConfigError("KPROCTOR_MALWARE_SCANNER (required in production)");
    if (!s3?.kmsKeyId)
      throw new ServerConfigError("KPROCTOR_S3_KMS_KEY_ID (required in production)");
  }

  const window = num("KPROCTOR_IDENTITY_RATE_WINDOW_SECONDS", 600, { min: 1 });
  cached = {
    production,
    storage,
    localDir: env.KPROCTOR_IDENTITY_LOCAL_DIR ?? ".data/identity-objects",
    masterKey,
    s3,
    scanner,
    clamav: {
      host: env.KPROCTOR_CLAMAV_HOST ?? "127.0.0.1",
      port: num("KPROCTOR_CLAMAV_PORT", 3310, { min: 1 }),
      timeoutMs: num("KPROCTOR_CLAMAV_TIMEOUT_MS", 15_000, { min: 100 }),
    },
    maxDocumentBytes: Math.round(num("KPROCTOR_IDENTITY_MAX_DOCUMENT_MB", 5, { min: 0.1 }) * MB),
    maxPhotoBytes: Math.round(num("KPROCTOR_IDENTITY_MAX_PHOTO_MB", 2, { min: 0.1 }) * MB),
    signedUrlTtlSeconds: num("KPROCTOR_IDENTITY_SIGNED_URL_TTL_SECONDS", 60, { min: 5 }),
    documentRetentionMs: num("KPROCTOR_IDENTITY_DOCUMENT_RETENTION_DAYS", 30, { min: 0 }) * DAY_MS,
    photoRetentionMs: num("KPROCTOR_IDENTITY_PHOTO_RETENTION_DAYS", 30, { min: 0 }) * DAY_MS,
    auditRetentionDays: env.KPROCTOR_AUDIT_RETENTION_DAYS
      ? num("KPROCTOR_AUDIT_RETENTION_DAYS", 0, { min: 1 })
      : null,
    maxRetries: num("KPROCTOR_IDENTITY_MAX_RETRIES", 2, { min: 0 }),
    processingTimeoutMs:
      num("KPROCTOR_IDENTITY_PROCESSING_TIMEOUT_SECONDS", 120, { min: 5 }) * 1000,
    rateLimits: {
      capture: {
        limit: num("KPROCTOR_IDENTITY_CAPTURE_LIMIT", 10, { min: 1 }),
        windowSeconds: window,
      },
      document: {
        limit: num("KPROCTOR_IDENTITY_UPLOAD_LIMIT", 10, { min: 1 }),
        windowSeconds: window,
      },
      verify: {
        limit: num("KPROCTOR_IDENTITY_VERIFY_LIMIT", 6, { min: 1 }),
        windowSeconds: window,
      },
      retry: { limit: num("KPROCTOR_IDENTITY_RETRY_LIMIT", 3, { min: 1 }), windowSeconds: window },
      status: { limit: 300, windowSeconds: window },
      reviewAccess: { limit: 60, windowSeconds: window },
    },
  };
  return cached;
}

/** Tests only: forget the cached configuration so env changes take effect. */
export function resetIdentityConfigForTests() {
  cached = null;
}

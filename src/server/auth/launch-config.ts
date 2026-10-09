import "@tanstack/react-start/server-only";
import { createPublicKey, type KeyObject } from "node:crypto";
import { loadServerEnv, ServerConfigError } from "../env";

/**
 * LMS → KProctor launch settings. Only the LMS's PUBLIC key lives here: the
 * LMS signs launch tokens with its private key, so a KProctor compromise can't
 * be used to forge launches.
 */
export interface LaunchConfig {
  production: boolean;
  /** Ed25519 public key that verifies LMS launch tokens; null = LMS launch disabled. */
  lmsPublicKey: KeyObject | null;
  lmsIssuer: string | null;
  audience: "kproctor-launch";
  /** Longest accepted token lifetime (exp - iat). */
  maxLifetimeSeconds: number;
  clockSkewSeconds: number;
  /** KProctor session cookie lifetime after a launch. */
  sessionTtlSeconds: number;
  /** The development launch link (`/api/auth/launch`, long-lived token in the URL). */
  allowDevLaunch: boolean;
}

function parsePublicKey(raw: string): KeyObject {
  const text = raw.includes("BEGIN")
    ? raw.replace(/\\n/g, "\n")
    : Buffer.from(raw, "base64").toString("utf8");
  const key = text.includes("BEGIN")
    ? createPublicKey(text)
    : createPublicKey({ key: Buffer.from(raw, "base64"), format: "der", type: "spki" });
  if (key.asymmetricKeyType !== "ed25519") {
    throw new ServerConfigError("KPROCTOR_LMS_LAUNCH_PUBLIC_KEY (must be an Ed25519 public key)");
  }
  return key;
}

let cached: LaunchConfig | null = null;

export function getLaunchConfig(): LaunchConfig {
  if (cached) return cached;
  loadServerEnv();
  const env = process.env;
  const production = env.NODE_ENV === "production";
  const rawKey = env.KPROCTOR_LMS_LAUNCH_PUBLIC_KEY?.trim();
  let lmsPublicKey: KeyObject | null = null;
  if (rawKey) {
    try {
      lmsPublicKey = parsePublicKey(rawKey);
    } catch (error) {
      if (error instanceof ServerConfigError) throw error;
      throw new ServerConfigError("KPROCTOR_LMS_LAUNCH_PUBLIC_KEY");
    }
  }
  const lmsIssuer = env.KPROCTOR_LMS_ISSUER?.trim() || null;
  if (lmsPublicKey && !lmsIssuer) throw new ServerConfigError("KPROCTOR_LMS_ISSUER");
  const num = (name: string, fallback: number, min: number, max: number) => {
    const raw = env[name]?.trim();
    if (!raw) return fallback;
    const v = Number(raw);
    if (!Number.isInteger(v) || v < min || v > max) throw new ServerConfigError(name);
    return v;
  };
  cached = {
    production,
    lmsPublicKey,
    lmsIssuer,
    audience: "kproctor-launch",
    maxLifetimeSeconds: num("KPROCTOR_LAUNCH_MAX_LIFETIME_SECONDS", 120, 10, 600),
    clockSkewSeconds: num("KPROCTOR_LAUNCH_CLOCK_SKEW_SECONDS", 30, 0, 120),
    sessionTtlSeconds: num("KPROCTOR_SESSION_TTL_MINUTES", 480, 5, 24 * 60) * 60,
    // The dev link puts a long-lived token in the URL: never on in production by default.
    allowDevLaunch: production ? env.KPROCTOR_ALLOW_DEV_LAUNCH === "true" : true,
  };
  return cached;
}

export function resetLaunchConfigForTests() {
  cached = null;
}

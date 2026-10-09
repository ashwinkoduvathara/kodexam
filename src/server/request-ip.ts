import "@tanstack/react-start/server-only";
import { getRequestIP } from "@tanstack/react-start/server";

/** Client IP for audit logs. Trusts X-Forwarded-For only when explicitly enabled. */
export function clientIp(): string | null {
  try {
    return getRequestIP({ xForwardedFor: process.env.KPROCTOR_TRUST_PROXY === "true" }) ?? null;
  } catch {
    return null;
  }
}

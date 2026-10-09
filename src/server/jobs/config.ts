import "@tanstack/react-start/server-only";
import { loadServerEnv, ServerConfigError } from "../env";
import type { ExpiryWorkerConfig } from "./expiry-worker";

function int(name: string, fallback: number, min: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) throw new ServerConfigError(name);
  return value;
}

/** Expiry worker settings (see documentation/17-operations.md). */
export function getExpiryWorkerConfig(): ExpiryWorkerConfig {
  loadServerEnv();
  return {
    intervalSeconds: int("KPROCTOR_EXPIRY_INTERVAL_SECONDS", 15, 1),
    batchSize: int("KPROCTOR_EXPIRY_BATCH_SIZE", 200, 1),
    leaseSeconds: int("KPROCTOR_EXPIRY_LEASE_SECONDS", 60, 5),
    alertAfterSeconds: int("KPROCTOR_EXPIRY_ALERT_SECONDS", 120, 10),
  };
}

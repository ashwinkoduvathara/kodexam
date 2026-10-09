import "@tanstack/react-start/server-only";
import type { Db } from "mongodb";
import { API_ERROR } from "@/types/api";
import { DomainError } from "./errors";

/**
 * Fixed-window rate limiter stored in MongoDB, so limits hold across server
 * instances. Counters expire through a TTL index (see indexes.ts).
 */
interface RateLimitDoc {
  _id: string;
  count: number;
  expiresAt: Date;
}

export const RATE_LIMIT_COLLECTION = "rateLimits";

export async function consumeRateLimit(
  db: Db,
  key: string,
  rule: { limit: number; windowSeconds: number },
  now: Date = new Date(),
): Promise<void> {
  const windowStart = Math.floor(now.getTime() / 1000 / rule.windowSeconds) * rule.windowSeconds;
  const id = `${key}:${windowStart}`;
  const doc = await db.collection<RateLimitDoc>(RATE_LIMIT_COLLECTION).findOneAndUpdate(
    { _id: id },
    {
      $inc: { count: 1 },
      $setOnInsert: { expiresAt: new Date((windowStart + rule.windowSeconds) * 1000) },
    },
    { upsert: true, returnDocument: "after" },
  );
  if ((doc?.count ?? 0) > rule.limit) {
    // Deliberately vague: the limits themselves aren't disclosed.
    throw new DomainError(
      API_ERROR.RATE_LIMITED,
      429,
      "Too many attempts. Please wait a few minutes and try again.",
    );
  }
}

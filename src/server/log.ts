import "@tanstack/react-start/server-only";

/**
 * Sanitised server logging. Only identifiers, event names, statuses and error
 * codes are ever written — never request bodies, documents, images, tokens,
 * signed URLs or credentials.
 */

type SafeValue = string | number | boolean | null | undefined;
const ALLOWED_FIELDS = new Set([
  "attemptId",
  "examId",
  "verificationId",
  "candidateId",
  "status",
  "event",
  "code",
  "provider",
  "scanStatus",
  "errorName",
  // Operational (jobs, launch): identifiers and counters only.
  "job",
  "workerId",
  "reason",
  "claimed",
  "closed",
  "alreadyClosed",
  "failed",
  "durationMs",
  "overdue",
  "oldestOverdueSeconds",
  "delaySeconds",
]);

function clean(fields: Record<string, SafeValue>) {
  return Object.fromEntries(
    Object.entries(fields).filter(([k, v]) => ALLOWED_FIELDS.has(k) && v !== undefined),
  );
}

export function logEvent(message: string, fields: Record<string, SafeValue> = {}) {
  console.info(`[kproctor] ${message}`, clean(fields));
}

/** Logs an error by name/code only. Messages can embed data, so they're dropped. */
export function logError(context: string, error: unknown, fields: Record<string, SafeValue> = {}) {
  const e = error as { name?: string; code?: string | number } | null;
  console.error(`[kproctor] ${context}`, {
    ...clean(fields),
    errorName: e?.name ?? typeof error,
    code: e?.code ?? undefined,
  });
}

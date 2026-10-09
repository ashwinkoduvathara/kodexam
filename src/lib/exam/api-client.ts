import { API_ERROR, type ApiErrorBody, type ApiErrorCode } from "@/types/api";

/** Typed API failure. `message` is candidate-safe (written by the server). */
export class ExamApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly status: number,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ExamApiError";
  }
}

export const NETWORK_MESSAGE =
  "We can't reach the exam server. Check your connection and try again.";

/**
 * Same-origin API call. JSON bodies by default; binary bodies (identity uploads)
 * are sent as-is so they never appear in URLs, query strings or browser storage.
 */
export async function apiRequest<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  options: { json?: unknown; body?: Blob; headers?: Record<string, string> } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        ...(options.json !== undefined ? { "content-type": "application/json" } : {}),
        ...options.headers,
      },
      body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
    });
  } catch {
    throw new ExamApiError(API_ERROR.SERVICE_UNAVAILABLE, 0, NETWORK_MESSAGE);
  }

  const data = (await res.json().catch(() => null)) as T | ApiErrorBody | null;
  if (!res.ok) {
    const error = (data as ApiErrorBody | null)?.error;
    throw new ExamApiError(
      error?.code ?? API_ERROR.INTERNAL,
      res.status,
      error?.message ?? "Something went wrong. Please try again.",
      error?.details,
    );
  }
  return data as T;
}

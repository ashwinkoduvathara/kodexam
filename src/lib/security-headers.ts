/**
 * Security headers applied to every response by the request middleware in
 * src/start.ts. Pure functions so they can be unit-tested.
 */

export interface SecurityHeaderOptions {
  /** Per-request CSP nonce; TanStack Router adds it to the scripts it renders. */
  nonce: string;
  /** Enforce the Content-Security-Policy (production builds only — Vite dev injects inline scripts). */
  enforceCsp: boolean;
  /** Request arrived over HTTPS (enables HSTS). */
  secure: boolean;
  /** Extra origins the page may call (e.g. an external network-test service). */
  extraConnectSrc?: string[];
}

export function buildContentSecurityPolicy(nonce: string, extraConnectSrc: string[] = []): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    // Inline style attributes are used by layout primitives; scripts stay nonce-only.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://res.cloudinary.com",
    "media-src 'self' blob:",
    `connect-src 'self'${extraConnectSrc.length ? ` ${extraConnectSrc.join(" ")}` : ""}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** Camera/microphone/fullscreen/screen capture only for this origin; everything else off. */
export const PERMISSIONS_POLICY = [
  "camera=(self)",
  "microphone=(self)",
  "fullscreen=(self)",
  "display-capture=(self)",
  "geolocation=()",
  "payment=()",
  "usb=()",
  "serial=()",
  "bluetooth=()",
  "magnetometer=()",
  "gyroscope=()",
].join(", ");

export function securityHeaders(options: SecurityHeaderOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "permissions-policy": PERMISSIONS_POLICY,
    "x-frame-options": "DENY",
    "cross-origin-opener-policy": "same-origin",
  };
  if (options.enforceCsp) {
    headers["content-security-policy"] = buildContentSecurityPolicy(
      options.nonce,
      options.extraConnectSrc,
    );
  }
  if (options.secure) headers["strict-transport-security"] = "max-age=31536000; includeSubDomains";
  return headers;
}

export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

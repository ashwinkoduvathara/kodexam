/**
 * TanStack Start entry: request middleware applied to every response
 * (pages, API routes, signed object downloads).
 */
import { createMiddleware, createStart } from "@tanstack/react-start";
import { generateNonce, securityHeaders } from "@/lib/security-headers";

const securityHeadersMiddleware = createMiddleware({ type: "request" }).server(
  async ({ request, next }) => {
    const nonce = generateNonce();
    const result = await next({ context: { nonce } });

    const url = new URL(request.url);
    const secure =
      url.protocol === "https:" ||
      (process.env.KPROCTOR_TRUST_PROXY === "true" &&
        request.headers.get("x-forwarded-proto") === "https");
    const networkTest = import.meta.env.VITE_NETWORK_TEST_BASE_URL as string | undefined;
    const extraConnectSrc = networkTest?.startsWith("http") ? [new URL(networkTest).origin] : [];
    const headers = securityHeaders({
      nonce,
      enforceCsp: import.meta.env.PROD,
      secure,
      extraConnectSrc,
    });

    let response = result.response;
    const apply = (target: Headers) => {
      // Handlers that set their own stricter policy (e.g. identity objects) keep it.
      for (const [name, value] of Object.entries(headers)) {
        if (!target.has(name)) target.set(name, value);
      }
    };
    try {
      apply(response.headers);
    } catch {
      // Some responses have immutable headers — re-wrap them.
      response = new Response(response.body, response);
      apply(response.headers);
    }
    return { ...result, response };
  },
);

export const startInstance = createStart(() => ({
  requestMiddleware: [securityHeadersMiddleware],
}));

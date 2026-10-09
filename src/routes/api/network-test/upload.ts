import { createFileRoute } from "@tanstack/react-router";
import { MAX_TEST_BYTES, NO_STORE } from "@/lib/exam/network-test.server";

export const Route = createFileRoute("/api/network-test/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Drain the body so timing on the client covers the full transfer.
        let received = 0;
        const reader = request.body?.getReader();
        if (reader) {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value.byteLength;
            if (received > MAX_TEST_BYTES) {
              await reader.cancel();
              return new Response("Payload too large", { status: 413, headers: NO_STORE });
            }
          }
        }
        return Response.json({ received }, { headers: NO_STORE });
      },
    },
  },
});

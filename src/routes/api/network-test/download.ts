import { createFileRoute } from "@tanstack/react-router";
import { MAX_TEST_BYTES, NO_STORE, randomChunk } from "@/lib/exam/network-test.server";

const CHUNK_SIZE = 64 * 1024;

export const Route = createFileRoute("/api/network-test/download")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const requested = Number(new URL(request.url).searchParams.get("bytes"));
        const total = Number.isFinite(requested)
          ? Math.min(Math.max(Math.floor(requested), 1), MAX_TEST_BYTES)
          : 1024 * 1024;

        const chunk = randomChunk(CHUNK_SIZE);
        let sent = 0;
        const body = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (sent >= total) {
              controller.close();
              return;
            }
            const size = Math.min(CHUNK_SIZE, total - sent);
            controller.enqueue(size === CHUNK_SIZE ? chunk : chunk.subarray(0, size));
            sent += size;
          },
        });

        return new Response(body, {
          headers: {
            ...NO_STORE,
            "content-type": "application/octet-stream",
            "content-length": String(total),
            // Random bytes don't compress, but make sure no proxy tries.
            "content-encoding": "identity",
          },
        });
      },
    },
  },
});

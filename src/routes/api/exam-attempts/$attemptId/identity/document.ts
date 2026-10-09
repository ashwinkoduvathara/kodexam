import { createFileRoute } from "@tanstack/react-router";
import { deleteIdentityDocument, uploadIdentityDocument } from "@/server/api/identity-api";
import { clientIp } from "@/server/request-ip";

export const Route = createFileRoute("/api/exam-attempts/$attemptId/identity/document")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        uploadIdentityDocument(request, params.attemptId, { ipAddress: clientIp() }),
      DELETE: ({ request, params }) =>
        deleteIdentityDocument(request, params.attemptId, { ipAddress: clientIp() }),
    },
  },
});

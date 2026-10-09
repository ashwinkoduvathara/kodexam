import { createFileRoute } from "@tanstack/react-router";
import { getExamPaper } from "@/server/api/exam-paper-api";
import { clientIp } from "@/server/request-ip";

export const Route = createFileRoute("/api/exam-attempts/$attemptId/paper")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        getExamPaper(request, params.attemptId, { ipAddress: clientIp() }),
    },
  },
});

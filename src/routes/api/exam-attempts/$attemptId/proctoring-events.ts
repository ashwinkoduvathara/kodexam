import { createFileRoute } from "@tanstack/react-router";
import { listProctoringEvents, recordProctoringEvent } from "@/server/api/exam-paper-api";
import { clientIp } from "@/server/request-ip";

export const Route = createFileRoute("/api/exam-attempts/$attemptId/proctoring-events")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        listProctoringEvents(request, params.attemptId, { ipAddress: clientIp() }),
      POST: ({ request, params }) =>
        recordProctoringEvent(request, params.attemptId, { ipAddress: clientIp() }),
    },
  },
});

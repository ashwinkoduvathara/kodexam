import { createFileRoute } from "@tanstack/react-router";
import { getExamSession } from "@/server/api/exam-api";
import { clientIp } from "@/server/request-ip";

export const Route = createFileRoute("/api/exams/$examId/session")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        getExamSession(request, params.examId, { ipAddress: clientIp() }),
    },
  },
});

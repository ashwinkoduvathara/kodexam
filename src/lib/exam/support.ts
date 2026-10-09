import { SUPPORT_CONFIG, type SupportConfig } from "./config";
import type { ExamSession } from "./types";

/** Pre-filled support email including the references support needs to find the attempt. */
export function supportMailto(session: ExamSession, support: SupportConfig = SUPPORT_CONFIG) {
  const subject = `System check help: [${session.examCode}] ${session.examName}`;
  const body = [
    `Candidate: ${session.candidateName}`,
    `Roll No: ${session.rollNumber}`,
    `Attempt ID: ${session.attemptId}`,
    "",
    "Describe the issue:",
    "",
  ].join("\n");
  return `mailto:${support.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

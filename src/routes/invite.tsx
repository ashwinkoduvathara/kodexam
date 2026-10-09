import { createFileRoute } from "@tanstack/react-router";
import { InvitePortal } from "@/components/invite/InvitePortal";

/** External Candidate Exam Invite Portal: candidates without an LMS account enter with an invite code. */
export const Route = createFileRoute("/invite")({
  head: () => ({ meta: [{ title: "Exam Invite · KProctor" }] }),
  component: InvitePortal,
});

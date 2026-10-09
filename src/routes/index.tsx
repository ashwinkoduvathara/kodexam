import { createFileRoute } from "@tanstack/react-router";
import { LockKeyhole } from "lucide-react";
import { Logo } from "@/components/layout/Logo";

interface LandingSearch {
  launch?: "invalid";
}

/** Candidates arrive via a signed launch link from the LMS, never by browsing here. */
export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): LandingSearch =>
    search.launch === "invalid" ? { launch: "invalid" } : {},
  component: Landing,
});

function Landing() {
  const { launch } = Route.useSearch();
  return (
    <main className="kp flex min-h-screen flex-col items-center justify-center gap-8 bg-surface px-6 font-sans text-navy">
      <Logo linked={false} className="h-9 sm:h-9" />
      <div className="max-w-md rounded-2xl border border-slate-200/70 bg-white p-8 text-center shadow-sm">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand">
          <LockKeyhole className="h-7 w-7" aria-hidden />
        </span>
        <h1 className="mt-5 text-xl font-extrabold">
          {launch === "invalid" ? "This exam link has expired." : "KProctor Exam Portal"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Open your exam from your Kodeversity dashboard to continue.
        </p>
      </div>
    </main>
  );
}

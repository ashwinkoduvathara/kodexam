import type { ReactNode } from "react";
import { Laptop } from "lucide-react";
import { Logo } from "@/components/layout/Logo";

/** Minimum viewport for the exam UI. Below this the candidate is asked to switch devices. */
export const EXAM_DESKTOP_QUERY = "(min-width: 1024px)";

/**
 * CSS-driven so the correct view is painted on first load (no SSR flash).
 * Screens that start hardware checks should additionally gate on
 * `useMediaQuery(EXAM_DESKTOP_QUERY, false)` so nothing runs on small screens.
 */
export function DesktopOnlyGate({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="hidden min-h-screen flex-col lg:flex">{children}</div>
      <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-6 py-12 lg:hidden">
        <Logo linked={false} className="h-9 sm:h-9" />
        <div className="mt-8 w-full max-w-sm rounded-2xl border border-slate-200/70 bg-white p-7 text-center shadow-sm">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand">
            <Laptop className="h-7 w-7" aria-hidden />
          </span>
          <h1 className="mt-5 text-lg font-extrabold leading-snug text-navy">
            Please use a desktop or laptop to take this examination.
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            Secure exams need a larger screen, a webcam and a microphone. Open this link on a
            computer to continue.
          </p>
        </div>
      </div>
    </>
  );
}

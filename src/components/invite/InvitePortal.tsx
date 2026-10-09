import {
  ArrowLeft,
  CalendarDays,
  Clock3,
  Mail,
  MonitorCheck,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { InviteForm } from "./InviteForm";
import { InviteIllustration } from "./InviteIllustration";

const FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: CalendarDays,
    title: "Secure Access",
    text: "Use the unique invite code provided by your examination coordinator.",
  },
  {
    icon: ShieldCheck,
    title: "Verified Identity",
    text: "Complete identity verification when required by the exam policy.",
  },
  {
    icon: MonitorCheck,
    title: "Monitored Examination",
    text: "Your exam may include camera, microphone and screen monitoring as per the policy.",
  },
  {
    icon: Clock3,
    title: "Time Bound",
    text: "Access is available only during the scheduled examination window.",
  },
];

/** External Candidate Exam Invite Portal (an isolated page; styles scoped under .kp). */
export function InvitePortal() {
  const lmsUrl = (import.meta.env.VITE_LMS_URL as string | undefined) || null;
  return (
    <div className="kp min-h-screen bg-[linear-gradient(180deg,#f8fbfd_0%,#f4f8f6_100%)] font-sans text-navy">
      <header className="flex h-[72px] items-center justify-between border-b border-slate-200/60 bg-white/70 px-6 backdrop-blur sm:px-10 lg:px-[88px]">
        <div className="flex flex-col gap-1">
          <Logo linked={false} className="h-8 sm:h-8" />
          <span className="pl-px text-[10px] font-bold uppercase tracking-[0.3em] text-slate-500">
            Exam Portal
          </span>
        </div>
        {lmsUrl && (
          <a
            href={lmsUrl}
            className="flex items-center gap-3 rounded-lg px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <ArrowLeft className="h-5 w-5 text-navy" aria-hidden />
            <span className="leading-tight">
              <span className="block text-sm font-bold text-navy">Back to Login</span>
              <span className="block text-xs text-slate-500">For Kodeversity students</span>
            </span>
          </a>
        )}
      </header>

      <main
        id="main-content"
        className="mx-auto grid max-w-[1440px] gap-10 px-6 py-8 sm:px-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,680px)] lg:gap-14 lg:px-[88px] lg:py-6"
      >
        <section aria-labelledby="invite-heading" className="flex flex-col pt-4">
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-brand-soft px-3.5 py-1.5 text-[13px] font-bold text-brand-strong">
            <Mail className="h-4 w-4" aria-hidden />
            Invite Access
          </span>
          <h1
            id="invite-heading"
            className="mt-4 text-[40px] font-extrabold leading-[1.1] tracking-tight text-navy sm:text-[48px]"
          >
            You’ve been invited.
          </h1>
          <p className="mt-3 max-w-[560px] text-[19px] leading-relaxed text-slate-600">
            Enter the exam invite code shared by your examination coordinator to access your
            assessment.
          </p>

          <ul className="mt-7 flex flex-col gap-6">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex items-start gap-5">
                <span className="grid h-[68px] w-[68px] shrink-0 place-items-center rounded-full bg-brand-soft/70 text-brand">
                  <Icon className="h-7 w-7" aria-hidden />
                </span>
                <div className="pt-1.5">
                  <h2 className="text-[17px] font-bold text-navy">{title}</h2>
                  <p className="mt-1 max-w-[400px] text-[15px] leading-snug text-slate-600">
                    {text}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <InviteIllustration className="mt-4 hidden w-full max-w-[640px] lg:block" />
        </section>

        <div className="lg:pt-0">
          <InviteForm lmsUrl={lmsUrl} />
        </div>
      </main>
    </div>
  );
}

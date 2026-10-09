import type { ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import {
  CircleCheck,
  Loader2,
  LockKeyhole,
  RotateCcw,
  SearchX,
  TimerOff,
  UserX,
  type LucideIcon,
} from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { Button } from "@/components/ui/button";
import { ExamApiError } from "@/lib/exam/session/http-exam-session-service";
import type { ExamSession } from "@/lib/exam/types";
import { API_ERROR } from "@/types/api";
import { ATTEMPT_STATUS } from "@/types/exam-attempt";
import { SupportDialog } from "./SupportDialog";

function StateCard({
  icon: Icon,
  tone,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  tone: "brand" | "danger" | "neutral";
  title: string;
  description: string;
  children?: ReactNode;
}) {
  const toneClass =
    tone === "brand"
      ? "bg-brand-soft text-brand"
      : tone === "danger"
        ? "bg-red-50 text-red-600"
        : "bg-slate-100 text-slate-600";
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className="mx-auto flex max-w-lg flex-col items-center rounded-2xl border border-slate-200/70 bg-white p-8 text-center shadow-sm"
    >
      <span className={`grid h-14 w-14 place-items-center rounded-2xl ${toneClass}`}>
        <Icon className="h-7 w-7" aria-hidden />
      </span>
      <h2 className="mt-5 text-xl font-extrabold text-navy">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">{description}</p>
      {children && <div className="mt-6 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

/** Full-page wrapper used before a session exists (loading / error). */
function StandalonePage({ children }: { children: ReactNode }) {
  return (
    <div className="kp flex min-h-screen flex-col items-center justify-center gap-8 bg-surface px-6 py-12 font-sans text-navy">
      <Logo linked={false} className="h-9 sm:h-9" />
      {children}
    </div>
  );
}

export function ExamLoadingState() {
  return (
    <StandalonePage>
      <div role="status" className="flex items-center gap-3 text-sm font-semibold text-slate-600">
        <Loader2 className="h-5 w-5 animate-spin text-brand" aria-hidden />
        Loading your exam session…
      </div>
    </StandalonePage>
  );
}

const ERROR_COPY: Record<string, { icon: LucideIcon; title: string; retry?: boolean }> = {
  [API_ERROR.UNAUTHENTICATED]: {
    icon: LockKeyhole,
    title: "We couldn't verify your exam session.",
  },
  [API_ERROR.NOT_FOUND]: { icon: SearchX, title: "Exam not found." },
  [API_ERROR.EXAM_NOT_ACTIVE]: { icon: TimerOff, title: "This exam isn't open right now." },
  [API_ERROR.ATTEMPT_LIMIT_REACHED]: { icon: UserX, title: "No attempts remaining." },
};

export function ExamSessionErrorState({ error }: { error: unknown }) {
  const router = useRouter();
  const apiError = error instanceof ExamApiError ? error : null;
  const copy = (apiError && ERROR_COPY[apiError.code]) ?? {
    icon: RotateCcw,
    title: "We couldn't load your exam.",
    retry: true,
  };
  const description =
    apiError?.message ?? "Something went wrong while loading your exam session. Please try again.";

  return (
    <StandalonePage>
      <StateCard icon={copy.icon} tone="danger" title={copy.title} description={description}>
        {copy.retry && (
          <Button
            onClick={() => void router.invalidate()}
            className="h-10 rounded-xl px-5 text-xs font-bold"
          >
            Try Again
          </Button>
        )}
      </StateCard>
    </StandalonePage>
  );
}

const CLOSED_COPY: Partial<
  Record<ExamSession["attemptStatus"], { icon: LucideIcon; title: string; description: string }>
> = {
  [ATTEMPT_STATUS.EXPIRED]: {
    icon: TimerOff,
    title: "Exam session has expired.",
    description: "The time allowed for this attempt has ended, so it can no longer be continued.",
  },
  [ATTEMPT_STATUS.SUBMITTED]: {
    icon: CircleCheck,
    title: "This exam has been submitted.",
    description: "Your answers have been recorded. You can close this window.",
  },
  [ATTEMPT_STATUS.AUTO_SUBMITTED]: {
    icon: CircleCheck,
    title: "This exam was submitted automatically.",
    description: "Time ran out, so your answers were submitted for you.",
  },
  [ATTEMPT_STATUS.CANCELLED]: {
    icon: UserX,
    title: "This exam attempt has ended.",
    description: "You left this examination. Contact support if this was a mistake.",
  },
};

/** Shown inside the exam shell when the server reports the attempt as closed. */
export function AttemptClosedNotice({ session }: { session: ExamSession }) {
  const copy = CLOSED_COPY[session.attemptStatus] ?? CLOSED_COPY[ATTEMPT_STATUS.EXPIRED]!;
  const lmsUrl = import.meta.env.VITE_LMS_URL as string | undefined;
  return (
    <div className="px-6 py-10">
      <StateCard
        icon={copy.icon}
        tone={session.attemptStatus === ATTEMPT_STATUS.EXPIRED ? "danger" : "neutral"}
        title={copy.title}
        description={copy.description}
      >
        <SupportDialog session={session}>
          <Button
            variant="outline"
            className="h-10 rounded-xl border-slate-200 px-5 text-xs font-bold text-brand-strong"
          >
            Contact Support
          </Button>
        </SupportDialog>
        {lmsUrl && (
          <Button asChild className="h-10 rounded-xl px-5 text-xs font-bold">
            <a href={lmsUrl}>Back to Dashboard</a>
          </Button>
        )}
      </StateCard>
    </div>
  );
}

import { AlertCircle, CheckCircle2, Clock3, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { IdentityStatusResponse } from "@/types/identity";

/**
 * Shows the server's verification outcome. Nothing here is decided locally —
 * a green state only ever reflects status VERIFIED from the server.
 */
export function VerificationStatusPanel({
  identity,
  retrying,
  onRetry,
}: {
  identity: IdentityStatusResponse;
  retrying: boolean;
  onRetry: () => void;
}) {
  switch (identity.status) {
    case "PROCESSING":
      return (
        <Panel
          tone="neutral"
          icon={<Loader2 className="h-5 w-5 animate-spin" />}
          title="Verifying your identity…"
        >
          This usually takes a moment. Please keep this page open.
        </Panel>
      );
    case "REVIEW_REQUIRED":
      return identity.canProceed ? (
        <Panel
          tone="info"
          icon={<Clock3 className="h-5 w-5" />}
          title="Submitted for review — you may continue"
        >
          An authorised examiner will confirm your identity. The exam policy allows you to start
          while the review is completed.
        </Panel>
      ) : (
        <Panel tone="info" icon={<Clock3 className="h-5 w-5" />} title="Manual review required">
          An authorised examiner will review your photo and ID. This page updates automatically —
          please keep it open.
        </Panel>
      );
    case "VERIFIED":
      return (
        <Panel tone="success" icon={<CheckCircle2 className="h-5 w-5" />} title="Identity verified">
          Your identity has been confirmed. You can continue to the exam.
        </Panel>
      );
    case "FAILED":
      return (
        <Panel
          tone="danger"
          icon={<AlertCircle className="h-5 w-5" />}
          title="We couldn't verify your identity"
        >
          {identity.retriesRemaining > 0 ? (
            <span className="flex flex-wrap items-center gap-3">
              You can try again with a new photo and ID image.
              <Button
                size="sm"
                onClick={onRetry}
                disabled={retrying}
                className="h-8 rounded-lg text-xs font-bold"
              >
                {retrying ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                Try Again
              </Button>
            </span>
          ) : (
            "No more attempts are available. Please contact support."
          )}
        </Panel>
      );
    case "EXPIRED":
      return (
        <Panel
          tone="danger"
          icon={<AlertCircle className="h-5 w-5" />}
          title="Exam session has expired."
        >
          Identity verification can no longer be completed for this attempt.
        </Panel>
      );
    default:
      return null;
  }
}

function Panel({
  tone,
  icon,
  title,
  children,
}: {
  tone: "neutral" | "info" | "success" | "danger";
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  const styles = {
    neutral: "border-slate-200 bg-slate-50 text-slate-700",
    info: "border-amber-200 bg-amber-50/70 text-amber-900",
    success: "border-brand/25 bg-brand-soft/70 text-brand-strong",
    danger: "border-red-200 bg-red-50/70 text-red-800",
  }[tone];
  return (
    <div
      role="status"
      aria-live="polite"
      data-identity-panel={tone}
      className={`flex items-start gap-3 rounded-2xl border px-5 py-3.5 ${styles}`}
    >
      <span className="mt-0.5 shrink-0" aria-hidden>
        {icon}
      </span>
      <div>
        <p className="text-sm font-bold">{title}</p>
        <div className="mt-0.5 text-xs leading-relaxed text-slate-700">{children}</div>
      </div>
    </div>
  );
}

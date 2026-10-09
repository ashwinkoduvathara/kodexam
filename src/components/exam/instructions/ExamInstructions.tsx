import { useState } from "react";
import { AlertCircle, ClipboardList, Info, TimerOff } from "lucide-react";
import { ExamApiError } from "@/lib/exam/session/http-exam-session-service";
import type { ExamSession } from "@/lib/exam/types";
import { API_ERROR } from "@/types/api";
import { ATTEMPT_STATUS } from "@/types/exam-attempt";
import { SecurityBanner } from "../system-check/SecurityBanner";
import { CandidateAcknowledgement } from "./CandidateAcknowledgement";
import { ExamOverview } from "./ExamOverview";
import { ImportantNotice } from "./ImportantNotice";
import { InstructionFooter } from "./InstructionFooter";
import { InstructionItem } from "./InstructionItem";
import { ProctoringInformation } from "./ProctoringInformation";
import { ProhibitedActivities } from "./ProhibitedActivities";
import { SectionHeading } from "./SectionHeading";

interface ExamInstructionsProps {
  session: ExamSession;
  expired: boolean;
  /** Persists the acknowledgement server-side. Resolves once the server confirms. */
  onAcknowledge: () => Promise<void>;
  onBack: () => void;
  /**
   * Revisiting after acknowledgement (from Identity Verification): the page is
   * read-only and Continue simply returns to the current step.
   */
  readOnly?: { onContinue: () => void };
}

export function ExamInstructions({
  session,
  expired,
  onAcknowledge,
  onBack,
  readOnly,
}: ExamInstructionsProps) {
  const [acknowledged, setAcknowledged] = useState(Boolean(readOnly));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expiredByServer, setExpiredByServer] = useState(false);

  const isExpired = expired || expiredByServer;
  const awaitingSystemCheck = session.attemptStatus === ATTEMPT_STATUS.SYSTEM_CHECK;
  const canAcknowledge = session.attemptStatus === ATTEMPT_STATUS.INSTRUCTIONS && !isExpired;

  const handleContinue = async () => {
    if (!acknowledged || !canAcknowledge) return;
    setPending(true);
    setError(null);
    try {
      await onAcknowledge();
    } catch (e) {
      if (e instanceof ExamApiError && e.code === API_ERROR.ATTEMPT_EXPIRED) {
        setExpiredByServer(true);
      } else {
        setError(e instanceof ExamApiError ? e.message : "Something went wrong. Please try again.");
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-[1320px] flex-col gap-3 px-6 pt-5 pb-6 min-[1400px]:px-8 short:pt-4">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-[28px] font-extrabold leading-tight tracking-tight text-navy short:text-2xl">
            Exam Instructions
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Please read the instructions carefully before starting your examination.
          </p>
        </div>
        <SecurityBanner
          title="Secure Examination"
          description="Your examination is monitored to maintain a secure and fair environment."
        />
      </div>

      <ImportantNotice allowPause={session.securityPolicy.allowPause} />

      <ExamOverview session={session} />

      <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-3 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section
          aria-labelledby="before-you-begin-heading"
          className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm"
        >
          <SectionHeading
            id="before-you-begin-heading"
            icon={ClipboardList}
            title="Before You Begin"
            description="Please make sure you understand the following examination guidelines."
          />
          <ul className="mt-3.5 grid grid-cols-2 gap-3">
            {session.instructions.map((instruction) => (
              <InstructionItem key={instruction.id} instruction={instruction} />
            ))}
          </ul>
        </section>

        <div className="flex flex-col gap-3">
          <ProctoringInformation policy={session.proctoringPolicy} />
          <ProhibitedActivities
            proctoringPolicy={session.proctoringPolicy}
            securityPolicy={session.securityPolicy}
          />
        </div>
      </div>

      {isExpired ? (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50/70 px-5 py-4 text-sm font-bold text-red-700"
        >
          <TimerOff className="h-5 w-5 shrink-0" aria-hidden />
          Exam session has expired.
        </div>
      ) : (
        <>
          {awaitingSystemCheck && (
            <p
              role="status"
              className="flex items-center gap-2.5 rounded-xl border border-sky-100 bg-sky-50/70 px-4 py-3 text-xs font-semibold text-slate-700"
            >
              <Info className="h-4 w-4 shrink-0 text-sky-600" aria-hidden />
              Complete the system check before continuing to identity verification.
            </p>
          )}
          <CandidateAcknowledgement
            checked={acknowledged}
            onCheckedChange={setAcknowledged}
            disabled={Boolean(readOnly) || !canAcknowledge || pending}
          />
        </>
      )}

      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50/70 px-4 py-3 text-xs font-semibold text-red-800"
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      <InstructionFooter
        canContinue={readOnly ? !isExpired : acknowledged && canAcknowledge}
        pending={pending}
        onBack={onBack}
        onContinue={readOnly ? readOnly.onContinue : () => void handleContinue()}
        continueLabel={
          readOnly
            ? session.attemptStatus === ATTEMPT_STATUS.READY
              ? "Return to Start Exam"
              : "Return to Identity Verification"
            : undefined
        }
      />
    </div>
  );
}

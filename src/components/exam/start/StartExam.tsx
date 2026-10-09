import { useRef, useState } from "react";
import { AlertCircle, TimerOff } from "lucide-react";
import { ExamApiError } from "@/lib/exam/session/http-exam-session-service";
import { getStartEligibility } from "@/lib/exam/start-eligibility";
import type { ExamSession } from "@/lib/exam/types";
import { API_ERROR } from "@/types/api";
import { CandidateAcknowledgement } from "../instructions/CandidateAcknowledgement";
import { ExamOverview } from "../instructions/ExamOverview";
import { InstructionFooter } from "../instructions/InstructionFooter";
import { ProctoringInformation } from "../instructions/ProctoringInformation";
import { BeforeYouStart } from "./BeforeYouStart";
import { ReadyStatusCard } from "./ReadyStatusCard";
import { StartImportantNotes } from "./StartImportantNotes";

interface StartExamProps {
  session: ExamSession;
  expired: boolean;
  /** Asks the server to start the exam. Resolves only once the server confirms IN_PROGRESS. */
  onStart: () => Promise<void>;
  /**
   * Re-reads the server session after a failed request. If the server did start
   * the exam (e.g. the response was lost), the route moves on to the active exam.
   */
  onReconcile: () => Promise<void>;
  onBack: () => void;
  backLabel: string;
}

const NETWORK_FAILURE =
  "We couldn't confirm that your exam started. Check your connection and try again.";

export function StartExam({
  session,
  expired,
  onStart,
  onReconcile,
  onBack,
  backLabel,
}: StartExamProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const eligibility = getStartEligibility(session, expired);

  const handleStart = async () => {
    if (!acknowledged || !eligibility.canStart || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      await onStart();
    } catch (e) {
      const apiError = e instanceof ExamApiError ? e : null;
      const lostResponse =
        !apiError ||
        apiError.code === API_ERROR.SERVICE_UNAVAILABLE ||
        apiError.code === API_ERROR.INTERNAL;
      setError(lostResponse ? NETWORK_FAILURE : apiError.message);
      // Whatever happened, the server's session decides what to show next.
      await onReconcile().catch(() => undefined);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-[1320px] flex-col gap-3 px-6 pt-5 pb-6 min-[1400px]:px-8 short:pt-4">
      <div className="flex items-start justify-between gap-6">
        <div className="pt-1">
          <h1 className="text-[32px] font-extrabold leading-tight tracking-tight text-navy short:text-[28px]">
            {eligibility.canStart ? "You’re ready to begin." : "Start Exam"}
          </h1>
          <p className="mt-1 text-[15px] text-slate-600">
            Take a moment to review your exam details before starting.
          </p>
        </div>
        <ReadyStatusCard eligibility={eligibility} />
      </div>

      <ExamOverview
        session={session}
        description="Here are the key details for your examination."
        iconTiles
      />

      <div className="grid grid-cols-[minmax(0,1fr)_380px] gap-3 xl:grid-cols-[minmax(0,1fr)_500px]">
        <BeforeYouStart allowPause={session.securityPolicy.allowPause} />
        <div className="flex flex-col gap-3">
          <ProctoringInformation
            policy={session.proctoringPolicy}
            title="Exam Monitoring Requirements"
            description="Your examination will be conducted with the following monitoring settings as per the exam policy."
            roomy
          />
          <StartImportantNotes />
        </div>
      </div>

      {expired ? (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50/70 px-5 py-4 text-sm font-bold text-red-700"
        >
          <TimerOff className="h-5 w-5 shrink-0" aria-hidden />
          Exam session has expired.
        </div>
      ) : (
        <CandidateAcknowledgement
          id="start-acknowledgement"
          label="I am ready to start my examination and agree to follow the examination rules."
          note={
            session.securityPolicy.allowPause
              ? "I understand that the timer will begin immediately after clicking Start Exam."
              : "I understand that the timer will begin immediately after clicking Start Exam, and I will not be able to pause the examination once it has started."
          }
          checked={acknowledged}
          onCheckedChange={setAcknowledged}
          disabled={!eligibility.canStart || pending}
        />
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
      <p className="sr-only" aria-live="polite">
        {pending ? "Starting your exam…" : ""}
      </p>

      <InstructionFooter
        canContinue={acknowledged && eligibility.canStart}
        pending={pending}
        onBack={onBack}
        onContinue={() => void handleStart()}
        continueLabel={pending ? "Starting Exam…" : "Start Exam"}
        backLabel={backLabel}
      />
    </div>
  );
}

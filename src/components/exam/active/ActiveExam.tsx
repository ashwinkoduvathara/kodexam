import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, Loader2, Maximize2, TimerOff } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { isDeviceFailure, useExamMonitoring, type DeviceStatus } from "@/hooks/use-exam-monitoring";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { ExamApiError } from "@/lib/exam/api-client";
import { getExamPaperClient } from "@/lib/exam/paper/exam-paper-client";
import { summarize } from "@/lib/exam/paper/question-state";
import type { ExamSession } from "@/lib/exam/types";
import { API_ERROR } from "@/types/api";
import type {
  AnswerState,
  ExamPaperResponse,
  ProctoringEventItem,
  ProctoringEventType,
} from "@/types/paper";
import { ExamStatusBar } from "./ExamStatusBar";
import { LiveCameraFeed } from "./LiveCameraFeed";
import { ProctoringAlerts } from "./ProctoringAlerts";
import { QuestionCard, type SaveStatus } from "./QuestionCard";
import { QuestionNavigator } from "./QuestionNavigator";
import { QuestionToolbar } from "./QuestionToolbar";

interface ActiveExamProps {
  session: ExamSession;
  /** True once the server deadline has passed on the clock. */
  expired: boolean;
  /** 1-based question number from the URL; validated against the server's paper. */
  questionNumber: number | undefined;
  onQuestionChange: (number: number) => void;
  refreshSession: () => Promise<void>;
}

const CLOSED_CODES: string[] = [API_ERROR.ATTEMPT_SUBMITTED, API_ERROR.ATTEMPT_EXPIRED];
const ALERTS_SHOWN = 3;

const newRequestId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/** Keeps whichever answer state is newer; a late visit response never rolls back an answer. */
function newer(prev: AnswerState | undefined, next: AnswerState): AnswerState {
  if (!prev || next.answerVersion >= prev.answerVersion) return next;
  return { ...prev, visited: prev.visited || next.visited, markedForReview: next.markedForReview };
}

export function ActiveExam({
  session,
  expired,
  questionNumber,
  onQuestionChange,
  refreshSession,
}: ActiveExamProps) {
  const client = getExamPaperClient();
  const attemptId = session.attemptId;
  const policy = session.proctoringPolicy;

  const [paper, setPaper] = useState<ExamPaperResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  /** Unsaved selections, kept in memory only (never in browser storage). */
  const [drafts, setDrafts] = useState<Record<string, string | null>>({});
  const [saveStatus, setSaveStatus] = useState<Record<string, SaveStatus>>({});
  const [markPending, setMarkPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingNav, setPendingNav] = useState<number | null>(null);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const requestIds = useRef<Record<string, { key: string; id: string }>>({});

  const [events, setEvents] = useState<ProctoringEventItem[]>([]);
  const [eventTotal, setEventTotal] = useState(0);
  const [eventsError, setEventsError] = useState<string | null>(null);

  /** The attempt was closed on the server (submitted / timed out): hand over to the shell. */
  const handleClosed = useCallback(
    (error: unknown) => {
      if (error instanceof ExamApiError && CLOSED_CODES.includes(error.code)) {
        closingRef.current = true;
        setClosing(true);
        void refreshSession().catch(() => undefined);
        return true;
      }
      return false;
    },
    [refreshSession],
  );

  // ── Paper ────────────────────────────────────────────────────────────────
  const loadPaper = useCallback(async () => {
    setLoadError(null);
    try {
      const p = await client.getPaper(attemptId);
      setPaper(p);
      setAnswers(Object.fromEntries(p.answers.map((a) => [a.questionId, a])));
    } catch (e) {
      if (!handleClosed(e)) {
        setLoadError(e instanceof ExamApiError ? e.message : "Couldn't load your questions.");
      }
    }
  }, [client, attemptId, handleClosed]);
  useEffect(() => {
    void loadPaper();
  }, [loadPaper]);

  const total = paper?.questions.length ?? 0;
  const index = total ? Math.min(Math.max((questionNumber ?? 1) - 1, 0), total - 1) : 0;
  const question = paper?.questions[index];
  const saved = question ? answers[question.id] : undefined;
  const hasDraft = question ? Object.prototype.hasOwnProperty.call(drafts, question.id) : false;
  const selection = question
    ? hasDraft
      ? drafts[question.id]
      : (saved?.selectedOptionId ?? null)
    : null;
  const dirty = Boolean(question && hasDraft && selection !== (saved?.selectedOptionId ?? null));
  const locked = expired || closing;

  // Keep the URL on a real question of this paper.
  useEffect(() => {
    if (total && questionNumber !== index + 1) onQuestionChange(index + 1);
  }, [total, questionNumber, index, onQuestionChange]);

  // Record the visit once (server state drives "Not Visited" in the navigator).
  useEffect(() => {
    if (!question || !saved || saved.visited || locked) return;
    client
      .saveAnswer(attemptId, question.id, { visited: true })
      .then((a) =>
        setAnswers((prev) => ({ ...prev, [a.questionId]: newer(prev[a.questionId], a) })),
      )
      .catch((e) => void handleClosed(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question?.id, saved?.visited, locked]);

  // ── Answers ──────────────────────────────────────────────────────────────
  const saveCurrent = useCallback(async (): Promise<boolean> => {
    if (!question || !saved || !dirty || locked) return !dirty;
    const qid = question.id;
    const draft = drafts[qid] ?? null;
    // Same draft + same base version → same requestId, so a retry is recognised by the server.
    const key = `${draft}:${saved.answerVersion}`;
    if (requestIds.current[qid]?.key !== key) requestIds.current[qid] = { key, id: newRequestId() };
    setSaveStatus((s) => ({ ...s, [qid]: { kind: "saving" } }));
    try {
      const a = await client.saveAnswer(attemptId, qid, {
        selectedOptionId: draft,
        expectedVersion: saved.answerVersion,
        requestId: requestIds.current[qid].id,
      });
      setAnswers((prev) => ({ ...prev, [qid]: a }));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[qid];
        return next;
      });
      setSaveStatus((s) => ({
        ...s,
        [qid]: { kind: "saved", at: a.savedAt ?? new Date().toISOString() },
      }));
      return true;
    } catch (e) {
      if (handleClosed(e)) return false;
      let message = "Couldn't save your answer. Check your connection and try again.";
      if (e instanceof ExamApiError) {
        if (e.code === API_ERROR.ANSWER_CONFLICT && e.details?.answer) {
          const current = e.details.answer as AnswerState;
          setAnswers((prev) => ({ ...prev, [qid]: current }));
          message = "This answer was changed in another window. Save again to keep your choice.";
        } else if (e.code !== API_ERROR.SERVICE_UNAVAILABLE && e.code !== API_ERROR.INTERNAL) {
          message = e.message;
        }
      }
      // The selection stays in memory so nothing the candidate chose is lost.
      setSaveStatus((s) => ({ ...s, [qid]: { kind: "failed", message } }));
      return false;
    }
  }, [question, saved, dirty, locked, drafts, client, attemptId, handleClosed]);

  const goTo = useCallback(
    (target: number) => {
      if (!paper || target < 0 || target >= paper.questions.length || target === index) return;
      if (dirty) {
        setPendingNav(target);
        return;
      }
      onQuestionChange(target + 1);
    },
    [paper, index, dirty, onQuestionChange],
  );

  const handleSave = async () => {
    if (dirty && !(await saveCurrent())) return; // stay on the question when saving fails
    if (paper && index < paper.questions.length - 1) onQuestionChange(index + 2);
  };

  const select = (optionId: string) => {
    if (!question || locked) return;
    setDrafts((prev) => ({ ...prev, [question.id]: optionId }));
    setSaveStatus((s) => ({ ...s, [question.id]: { kind: "idle" } }));
  };

  const clear = () => {
    if (!question || locked) return;
    setDrafts((prev) => ({ ...prev, [question.id]: null }));
    setSaveStatus((s) => ({ ...s, [question.id]: { kind: "idle" } }));
  };

  const toggleMark = async () => {
    if (!question || !saved || locked) return;
    setMarkPending(true);
    setNotice(null);
    try {
      const a = await client.saveAnswer(attemptId, question.id, {
        markedForReview: !saved.markedForReview,
      });
      setAnswers((prev) => ({ ...prev, [a.questionId]: newer(prev[a.questionId], a) }));
    } catch (e) {
      if (!handleClosed(e)) setNotice("Couldn't update Mark for Review. Please try again.");
    } finally {
      setMarkPending(false);
    }
  };

  // Warn before leaving the page with an unsaved answer.
  const anyDirty = useMemo(
    () =>
      Object.entries(drafts).some(
        ([qid, draft]) => draft !== (answers[qid]?.selectedOptionId ?? null),
      ),
    [drafts, answers],
  );
  useEffect(() => {
    if (!anyDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [anyDirty]);

  // ── Monitoring and proctoring events ────────────────────────────────────
  const monitoring = useExamMonitoring({
    camera: policy.cameraRequired,
    microphone: policy.microphoneRequired,
  });
  const fullscreen = useFullscreen();

  const loadEvents = useCallback(async () => {
    try {
      const r = await client.listEvents(attemptId, ALERTS_SHOWN);
      setEvents(r.events);
      setEventTotal(r.total);
      setEventsError(null);
    } catch (e) {
      if (!handleClosed(e)) setEventsError("Couldn't load recorded events.");
    }
  }, [client, attemptId, handleClosed]);
  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const [policyNotice, setPolicyNotice] = useState<string | null>(null);
  const record = useCallback(
    async (type: ProctoringEventType) => {
      if (closingRef.current) return;
      try {
        const result = await client.recordEvent(attemptId, type);
        // The server's event policy decides whether to show a (neutral) reminder.
        if (result.notice) setPolicyNotice(result.notice);
        if (result.examEnded) {
          closingRef.current = true;
          setClosing(true);
          void refreshSession().catch(() => undefined);
          return;
        }
        await loadEvents();
      } catch (e) {
        handleClosed(e);
      }
    },
    [client, attemptId, loadEvents, handleClosed, refreshSession],
  );

  useDeviceEvents(policy.cameraRequired, monitoring.camera, "CAMERA", record);
  useDeviceEvents(policy.microphoneRequired, monitoring.microphone, "MICROPHONE", record);

  // Fullscreen exits are recorded only when the exam requires fullscreen.
  const exitedFullscreen = useRef(false);
  useEffect(() => {
    if (!policy.fullscreenRequired || fullscreen.exitCount === 0) return;
    exitedFullscreen.current = true;
    void record("FULLSCREEN_EXITED");
  }, [fullscreen.exitCount, policy.fullscreenRequired, record]);
  useEffect(() => {
    if (fullscreen.isFullscreen && exitedFullscreen.current) {
      exitedFullscreen.current = false;
      void record("FULLSCREEN_RESTORED");
    }
  }, [fullscreen.isFullscreen, record]);

  useEffect(() => {
    if (session.securityPolicy.allowTabSwitch) return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void record("TAB_HIDDEN");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [session.securityPolicy.allowTabSwitch, record]);

  // ── Time up: the server closes the attempt; poll until it reports the final state ──
  useEffect(() => {
    if (!expired) return;
    closingRef.current = true;
    setClosing(true);
    let tries = 0;
    let timer = 0;
    const tick = async () => {
      tries += 1;
      await refreshSession().catch(() => undefined);
      if (tries < 20) timer = window.setTimeout(() => void tick(), 2000);
    };
    timer = window.setTimeout(() => void tick(), 800);
    return () => window.clearTimeout(timer);
  }, [expired, refreshSession]);

  const counts = useMemo(
    () => (paper ? summarize(paper.questions.map((q) => answers[q.id]).filter(Boolean)) : null),
    [paper, answers],
  );
  const answeredCount = counts ? counts.answered + counts.answered_marked : 0;

  // ── Render ───────────────────────────────────────────────────────────────
  const sidebar = (
    <aside
      aria-label="Proctoring and navigation"
      className="flex w-[360px] shrink-0 flex-col gap-3 overflow-y-auto pb-1 xl:w-[400px]"
    >
      <LiveCameraFeed
        camera={monitoring.camera}
        microphone={monitoring.microphone}
        stream={monitoring.stream}
        videoRef={monitoring.videoRef}
        onRetry={() => void monitoring.retry()}
      />
      <ProctoringAlerts
        events={events}
        total={eventTotal}
        loadError={eventsError}
        onViewAll={async () => (await client.listEvents(attemptId, 100)).events}
      />
      {paper && paper.questions.length > 0 && (
        <QuestionNavigator paper={paper} answers={answers} currentIndex={index} onSelect={goTo} />
      )}
    </aside>
  );

  let workspace: React.ReactNode;
  if (loadError) {
    workspace = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200/70 bg-white p-10 text-center">
        <AlertCircle className="h-8 w-8 text-red-500" aria-hidden />
        <p role="alert" className="text-sm font-semibold text-navy">
          {loadError}
        </p>
        <Button onClick={() => void loadPaper()} className="h-10 rounded-xl px-5 text-xs font-bold">
          Try Again
        </Button>
      </div>
    );
  } else if (!paper) {
    workspace = (
      <div
        role="status"
        className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-slate-200/70 bg-white text-sm text-slate-500"
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading your questions…
      </div>
    );
  } else if (!question || !saved) {
    workspace = (
      <div
        role="status"
        className="flex flex-1 items-center justify-center rounded-2xl border border-slate-200/70 bg-white p-10 text-center text-sm text-slate-600"
      >
        No questions are available for this exam. Please contact support.
      </div>
    );
  } else {
    workspace = (
      <>
        <QuestionToolbar
          sections={paper.sections}
          currentSectionId={question.sectionId}
          questionNumber={question.number}
          questionCount={total}
          marked={saved.markedForReview}
          markPending={markPending}
          disabled={locked}
          onSectionChange={(sectionId) =>
            goTo(paper.questions.findIndex((q) => q.sectionId === sectionId))
          }
          onToggleMark={() => void toggleMark()}
        />
        {notice && (
          <p
            role="alert"
            className="rounded-xl border border-red-100 bg-red-50/70 px-4 py-2 text-xs font-semibold text-red-800"
          >
            {notice}
          </p>
        )}
        <QuestionCard
          question={question}
          saved={saved}
          selection={selection}
          dirty={dirty}
          saveStatus={saveStatus[question.id] ?? { kind: "idle" }}
          locked={locked}
          isLast={index === total - 1}
          onSelect={select}
          onClear={clear}
          onSave={() => void handleSave()}
        />
        <div className="flex h-16 shrink-0 items-center justify-between rounded-2xl border border-slate-200/70 bg-white px-4 shadow-sm short:h-14">
          <Button
            variant="outline"
            onClick={() => goTo(index - 1)}
            disabled={index === 0 || locked}
            className="h-11 rounded-xl border-slate-200 px-5 text-sm font-bold text-navy shadow-sm"
          >
            <ArrowLeft aria-hidden />
            Previous
          </Button>
          <p className="text-xs font-semibold text-slate-500">
            <span className="text-navy">{answeredCount}</span> of {total} answered
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="flex h-[calc(100vh-64px-68px)] gap-4 px-5 py-4 short:py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {policy.fullscreenRequired && fullscreen.isSupported && !fullscreen.isFullscreen && (
            <div
              role="alert"
              className="flex shrink-0 items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-900"
            >
              This exam must run in fullscreen.
              <Button
                size="sm"
                onClick={() => void fullscreen.enter()}
                className="h-8 rounded-lg px-3 text-xs font-bold"
              >
                <Maximize2 aria-hidden />
                Enter Full Screen
              </Button>
            </div>
          )}
          {policyNotice && (
            <div
              role="status"
              className="flex shrink-0 items-center justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-xs font-semibold text-sky-900"
            >
              {policyNotice}
              <button
                type="button"
                onClick={() => setPolicyNotice(null)}
                className="rounded-md px-2 py-1 text-xs font-bold text-sky-800 hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
              >
                Dismiss
              </button>
            </div>
          )}
          {workspace}
        </div>
        {sidebar}
      </div>

      <ExamStatusBar
        policy={policy}
        camera={monitoring.camera}
        microphone={monitoring.microphone}
        fullscreen={{ supported: fullscreen.isSupported, active: fullscreen.isFullscreen }}
        onEnterFullscreen={() => void fullscreen.enter()}
      />

      <AlertDialog open={pendingNav !== null} onOpenChange={(o) => !o && setPendingNav(null)}>
        <AlertDialogContent className="kp max-w-md rounded-2xl border-slate-200 bg-white p-6">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-extrabold text-navy">
              You have an unsaved answer
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed text-slate-600">
              Your change to question {question?.number} hasn't been saved. Save it before moving
              on, or discard the change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-2 gap-2">
            <Button
              variant="outline"
              onClick={() => setPendingNav(null)}
              className="h-10 rounded-xl text-xs font-bold text-navy"
            >
              Stay
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const target = pendingNav;
                if (question) {
                  setDrafts((prev) => {
                    const next = { ...prev };
                    delete next[question.id];
                    return next;
                  });
                }
                setPendingNav(null);
                if (target !== null) onQuestionChange(target + 1);
              }}
              className="h-10 rounded-xl border-red-200 text-xs font-bold text-red-600"
            >
              Discard Change
            </Button>
            <Button
              onClick={async () => {
                const target = pendingNav;
                setPendingNav(null);
                if ((await saveCurrent()) && target !== null) onQuestionChange(target + 1);
              }}
              className="h-10 rounded-xl text-xs font-bold"
            >
              Save &amp; Continue
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {closing && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="time-up-title"
          className="fixed inset-0 z-50 grid place-items-center bg-navy/40 backdrop-blur-[2px]"
        >
          <div className="kp flex max-w-sm flex-col items-center gap-3 rounded-2xl bg-white p-7 text-center shadow-xl">
            <TimerOff className="h-8 w-8 text-red-500" aria-hidden />
            <h2 id="time-up-title" className="text-lg font-extrabold text-navy">
              {expired ? "Time is up" : "This exam has ended"}
            </h2>
            <p className="flex items-center gap-2 text-sm text-slate-600">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Confirming the final state with the exam server…
            </p>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Records a device outage once when it starts and once when the device is live
 * again (reconnecting passes through "starting", so this tracks the outage, not
 * adjacent states). Only while the exam policy requires the device.
 */
function useDeviceEvents(
  required: boolean,
  status: DeviceStatus,
  device: "CAMERA" | "MICROPHONE",
  record: (type: ProctoringEventType) => Promise<void>,
) {
  const inOutage = useRef(false);
  useEffect(() => {
    if (!required) return;
    if (isDeviceFailure(status) && !inOutage.current) {
      inOutage.current = true;
      void record(`${device}_DISCONNECTED`);
    } else if (status === "live" && inOutage.current) {
      inOutage.current = false;
      void record(`${device}_RESTORED`);
    }
  }, [required, status, device, record]);
}

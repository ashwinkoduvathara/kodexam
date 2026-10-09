import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, LockKeyhole, TimerOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ExamApiError } from "@/lib/exam/api-client";
import { getIdentityService } from "@/lib/exam/identity/identity-service";
import type { ExamSession } from "@/lib/exam/types";
import { cn } from "@/lib/utils";
import { API_ERROR } from "@/types/api";
import type { IdDocumentType, IdentityStatusResponse } from "@/types/identity";
import { SecurityBanner } from "../system-check/SecurityBanner";
import { GovernmentIdUpload, type LocalDocumentPreview } from "./GovernmentIdUpload";
import {
  IdentityInfoBanner,
  ImportantNotes,
  PrivacyCard,
  VerificationGuidelines,
} from "./IdentitySidePanels";
import { LiveCameraVerification } from "./LiveCameraVerification";
import { VerificationStatusPanel } from "./VerificationStatusPanel";

/** States in which the candidate can still change their photo/document. */
const EDITABLE = ["CAMERA_PENDING", "PHOTO_CAPTURED", "DOCUMENT_PENDING", "DOCUMENT_UPLOADED"];
const POLL_MS = 8000;

type Busy = null | "capture" | "upload" | "delete" | "verify" | "retry";

interface IdentityVerificationProps {
  session: ExamSession;
  expired: boolean;
  /** Called once the server allows the candidate to proceed. */
  onProceed: () => Promise<void>;
  onBack: () => void;
}

const messageOf = (e: unknown) =>
  e instanceof ExamApiError ? e.message : "Something went wrong. Please try again.";

export function IdentityVerification({
  session,
  expired,
  onProceed,
  onBack,
}: IdentityVerificationProps) {
  const service = getIdentityService();
  const attemptId = session.attemptId;
  const [identity, setIdentity] = useState<IdentityStatusResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expiredByServer, setExpiredByServer] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [errors, setErrors] = useState<{ camera?: string; document?: string; verify?: string }>({});
  const [cameraLive, setCameraLive] = useState(false);
  const [consent, setConsent] = useState(false);
  const [proceeding, setProceeding] = useState(false);

  // In-memory previews only (object URLs). Nothing is written to browser storage.
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [docPreview, setDocPreview] = useState<LocalDocumentPreview | null>(null);
  const urls = useRef<string[]>([]);
  const track = (url: string) => (urls.current.push(url), url);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const handleError = useCallback((e: unknown, key: "camera" | "document" | "verify") => {
    if (e instanceof ExamApiError && e.code === API_ERROR.ATTEMPT_EXPIRED) setExpiredByServer(true);
    setErrors((prev) => ({ ...prev, [key]: messageOf(e) }));
  }, []);

  // Load (and start, if needed) the server-side verification record.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let status = await service.getStatus(attemptId);
        if (status.status === "NOT_STARTED") status = await service.start(attemptId);
        if (!cancelled) setIdentity(status);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ExamApiError && e.code === API_ERROR.ATTEMPT_EXPIRED)
          setExpiredByServer(true);
        setLoadError(messageOf(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [service, attemptId]);

  // Poll while the server is processing or a reviewer has yet to decide.
  const waiting =
    identity?.status === "PROCESSING" ||
    (identity?.status === "REVIEW_REQUIRED" && !identity.canProceed);
  useEffect(() => {
    if (!waiting) return;
    const id = window.setInterval(async () => {
      try {
        setIdentity(await service.getStatus(attemptId));
      } catch {
        /* transient — keep polling */
      }
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [waiting, service, attemptId]);

  const run = async (
    kind: Exclude<Busy, null>,
    key: "camera" | "document" | "verify",
    fn: () => Promise<void>,
  ) => {
    setBusy(kind);
    setErrors((prev) => ({ ...prev, [key]: undefined }));
    try {
      await fn();
    } catch (e) {
      handleError(e, key);
    } finally {
      setBusy(null);
    }
  };

  const onCapture = (photo: Blob) =>
    run("capture", "camera", async () => {
      const next = await service.capturePhoto(attemptId, photo);
      setPhotoPreview(track(URL.createObjectURL(photo)));
      setIdentity(next);
    });

  const onUpload = (file: File, documentType: IdDocumentType) =>
    void run("upload", "document", async () => {
      const next = await service.uploadDocument(attemptId, file, documentType);
      setIdentity(next);
      setDocPreview({
        url: file.type.startsWith("image/") ? track(URL.createObjectURL(file)) : null,
        sizeBytes: file.size,
      });
    });

  const onDelete = () =>
    void run("delete", "document", async () => {
      setIdentity(await service.deleteDocument(attemptId));
      setDocPreview(null);
    });

  const onVerify = () =>
    void run("verify", "verify", async () => {
      const result = await service.verify(attemptId);
      setIdentity(result.identity);
    });

  const onRetry = () =>
    void run("retry", "verify", async () => {
      setIdentity(await service.retry(attemptId));
      setPhotoPreview(null);
      setDocPreview(null);
      setConsent(false);
    });

  const handleProceed = async () => {
    setProceeding(true);
    try {
      await onProceed();
    } catch (e) {
      handleError(e, "verify");
      setProceeding(false);
    }
  };

  const isExpired = expired || expiredByServer || identity?.status === "EXPIRED";

  if (typeof window !== "undefined" && !window.isSecureContext) {
    return <SecureConnectionRequired />;
  }

  const editable = identity !== null && EDITABLE.includes(identity.status) && !isExpired;
  const readyToVerify =
    editable &&
    identity.status === "DOCUMENT_UPLOADED" &&
    identity.photo.captured &&
    identity.document.present &&
    identity.document.scanStatus !== "INFECTED" &&
    cameraLive &&
    consent &&
    busy === null;
  const canProceed = Boolean(identity?.canProceed) && !isExpired;

  return (
    <div className="mx-auto flex max-w-[1320px] flex-col gap-3 px-6 pb-6 pt-5 min-[1400px]:px-8 short:pt-4">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-[28px] font-extrabold leading-tight tracking-tight text-navy short:text-2xl">
            Identity Verification
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Let&apos;s verify your identity before starting the examination.
          </p>
        </div>
        <SecurityBanner
          title="Secure Examination"
          description="This verification helps maintain a secure and fair examination environment."
        />
      </div>

      <IdentityInfoBanner />

      {loadError && !identity && (
        <p
          role="alert"
          className="rounded-xl border border-red-100 bg-red-50/70 px-4 py-3 text-sm font-semibold text-red-800"
        >
          {loadError}
        </p>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-3 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-3">
          {editable ? (
            <LiveCameraVerification
              photoCaptured={identity.photo.captured}
              photoCapturedAt={identity.photo.capturedAt}
              photoPreviewUrl={photoPreview}
              canCapture={busy === null}
              capturing={busy === "capture"}
              error={errors.camera ?? null}
              onCapture={onCapture}
              onReadyChange={setCameraLive}
            />
          ) : (
            <CameraClosedNote identity={identity} />
          )}
          {identity && (
            <GovernmentIdUpload
              document={identity.document}
              limits={identity.limits}
              preview={docPreview}
              enabled={editable && identity.photo.captured}
              uploading={busy === "upload"}
              deleting={busy === "delete"}
              error={errors.document ?? identity.lastError?.message ?? null}
              onUpload={onUpload}
              onDelete={onDelete}
            />
          )}
        </div>
        <div className="flex flex-col gap-3">
          <VerificationGuidelines />
          <ImportantNotes />
          <PrivacyCard retention={identity?.retention ?? null} />
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
      ) : identity && !editable ? (
        <VerificationStatusPanel
          identity={identity}
          retrying={busy === "retry"}
          onRetry={onRetry}
        />
      ) : (
        <div
          className={cn(
            "flex items-start gap-3.5 rounded-2xl border px-5 py-3.5 transition-colors",
            consent ? "border-brand/25 bg-brand-soft/60" : "border-sky-100 bg-sky-50/60",
          )}
        >
          <Checkbox
            id="identity-consent"
            checked={consent}
            onCheckedChange={(v) => setConsent(v === true)}
            disabled={!editable || busy !== null}
            aria-describedby="identity-consent-note"
            className="mt-0.5 h-5 w-5 rounded-md border-slate-300 bg-white data-[state=checked]:border-brand [&_svg]:h-3.5 [&_svg]:w-3.5"
          />
          <div>
            <label
              htmlFor="identity-consent"
              className="cursor-pointer text-sm font-bold text-navy"
            >
              I confirm that this photo and ID document belong to me and that the information is
              genuine.
            </label>
            <p id="identity-consent-note" className="mt-1 text-xs text-slate-600">
              Submitting someone else&apos;s identity or an altered document may result in
              disqualification from the examination.
            </p>
          </div>
        </div>
      )}

      {errors.verify && (
        <p
          role="alert"
          className="rounded-xl border border-red-100 bg-red-50/70 px-4 py-3 text-xs font-semibold text-red-800"
        >
          {errors.verify}
        </p>
      )}

      <div className="flex items-center justify-between gap-4">
        <Button
          variant="outline"
          onClick={onBack}
          disabled={busy !== null || proceeding}
          className="h-11 rounded-xl border-slate-200 bg-white px-5 text-sm font-bold text-navy shadow-sm"
        >
          <ArrowLeft aria-hidden />
          Back to Exam Instructions
        </Button>
        {canProceed ? (
          <Button
            onClick={() => void handleProceed()}
            disabled={proceeding}
            className="h-11 min-w-[240px] rounded-xl px-7 text-sm font-bold shadow-[0_8px_20px_-10px] shadow-brand/60"
          >
            {proceeding && <Loader2 className="animate-spin" aria-hidden />}
            Continue to Start Exam
            <ArrowRight aria-hidden />
          </Button>
        ) : (
          <Button
            onClick={onVerify}
            disabled={!readyToVerify}
            className={cn(
              "h-11 min-w-[240px] rounded-xl px-7 text-sm font-bold",
              readyToVerify
                ? "shadow-[0_8px_20px_-10px] shadow-brand/60"
                : "disabled:bg-brand/35 disabled:opacity-100 disabled:shadow-none",
            )}
          >
            {busy === "verify" && <Loader2 className="animate-spin" aria-hidden />}
            Verify &amp; Continue
            {busy !== "verify" && <ArrowRight aria-hidden />}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Once submitted, the live camera is switched off — the preview isn't needed any more. */
function CameraClosedNote({ identity }: { identity: IdentityStatusResponse | null }) {
  return (
    <section
      className="flex items-center gap-3 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm"
      data-section="camera"
    >
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-soft text-brand">
        <LockKeyhole className="h-5 w-5" aria-hidden />
      </span>
      <div className="text-xs leading-relaxed text-slate-600">
        <p className="text-sm font-bold text-navy">Live Camera Verification</p>
        {identity
          ? identity.photo.captured
            ? "Your verification photo has been submitted. The live camera preview is switched off."
            : "The live camera preview is switched off."
          : "Loading your verification…"}
      </div>
    </section>
  );
}

function SecureConnectionRequired() {
  return (
    <div
      className="mx-auto mt-10 flex max-w-lg flex-col items-center rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm"
      role="alert"
    >
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-red-50 text-red-600">
        <LockKeyhole className="h-7 w-7" aria-hidden />
      </span>
      <h2 className="mt-5 text-xl font-extrabold text-navy">Secure connection required</h2>
      <p className="mt-2 text-sm text-slate-600">
        Identity verification only works over a secure (HTTPS) connection. Open the exam from your
        Kodeversity dashboard again.
      </p>
    </div>
  );
}

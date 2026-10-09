import { useState } from "react";
import { ArrowRight, ClipboardCheck, Info, LockKeyhole, ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SectionHeading } from "../instructions/SectionHeading";

export function IdentityInfoBanner() {
  return (
    <div className="flex items-center gap-3.5 rounded-2xl border border-sky-100 bg-sky-50/60 px-4 py-3 short:py-2.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-sky-600 shadow-sm ring-1 ring-sky-100">
        <Info className="h-4.5 w-4.5" aria-hidden />
      </span>
      <div className="min-w-0">
        <h2 className="text-[13px] font-bold text-navy">Why is identity verification required?</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
          We verify your identity to ensure that only the registered candidate is taking the
          examination. This helps maintain the integrity and fairness of the exam process.
        </p>
      </div>
    </div>
  );
}

const GUIDELINES = [
  "Ensure you are in a well-lit environment",
  "Keep your face clearly visible to the camera",
  "Remove sunglasses, hats or face coverings",
  "Use a valid and original government ID proof",
  "Make sure the ID image is clear and readable",
  "Your face should match the ID document",
];

export function VerificationGuidelines() {
  return (
    <section
      aria-labelledby="idv-guidelines-heading"
      className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm"
    >
      <SectionHeading
        id="idv-guidelines-heading"
        icon={ClipboardCheck}
        title="Verification Guidelines"
        description="Please follow the instructions below for a successful verification."
      />
      <ol className="mt-2.5 space-y-1.5">
        {GUIDELINES.map((g, i) => (
          <li key={g} className="flex items-center gap-3 text-xs text-slate-700">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-soft text-[11px] font-bold text-brand-strong">
              {i + 1}
            </span>
            {g}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function ImportantNotes() {
  const notes = [
    "The information you provide will be used only for examination verification.",
    "Do not upload edited or fake documents.",
    "Your photo and ID are reviewed to confirm your identity; this may include review by an authorised examiner.",
    "If the verification fails, you may be asked to try again or contact support.",
  ];
  return (
    <section
      aria-labelledby="idv-notes-heading"
      className="rounded-2xl border border-red-200/70 bg-red-50/50 p-4"
    >
      <SectionHeading
        id="idv-notes-heading"
        icon={ShieldAlert}
        tone="danger"
        title="Important Notes"
      />
      <ul className="mt-2 space-y-1">
        {notes.map((n) => (
          <li key={n} className="flex items-start gap-2 text-[11px] leading-snug text-slate-700">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" aria-hidden />
            {n}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Every statement here is enforced by the backend:
 * - the live preview is never uploaded; only one still photo is sent when the candidate captures it
 * - objects are encrypted at rest (AES-256-GCM locally, SSE-KMS on S3)
 * - retention periods come from the server configuration
 */
export function PrivacyCard({
  retention,
}: {
  retention: { documentDays: number; photoDays: number } | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section
      aria-labelledby="idv-privacy-heading"
      className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm"
    >
      <SectionHeading id="idv-privacy-heading" icon={LockKeyhole} title="Your Privacy" />
      <p className="mt-2 text-[11px] leading-snug text-slate-600">
        Your identity information is used only for examination verification and is handled according
        to the examination privacy policy.
      </p>
      <p className="mt-1 text-[11px] leading-snug text-slate-600">
        Your camera feed is processed only as required for verification. Continuous recording is not
        performed during this verification step.
      </p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1.5 inline-flex items-center gap-1 text-xs font-bold text-brand-strong hover:underline"
      >
        Learn more <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="kp max-w-md rounded-2xl border-slate-200 bg-white p-6">
          <DialogHeader className="text-left">
            <DialogTitle className="text-lg font-extrabold text-navy">
              How your data is handled
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-600">
              Identity verification for this examination.
            </DialogDescription>
          </DialogHeader>
          <ul className="mt-2 space-y-2.5 text-sm leading-relaxed text-slate-700">
            <li>
              Your live camera preview stays on your device. Only the single photo you choose to
              capture is sent for verification.
            </li>
            <li>
              Your ID document and photo are sent over a secure connection and encrypted at rest.
            </li>
            <li>We don't ask for, store or display your ID number.</li>
            <li>
              Only authorised examiners can view your photo and ID, through links that expire within
              about a minute. Every view is recorded.
            </li>
            {retention && (
              <li>
                Under the current retention policy, your ID document is scheduled for deletion after{" "}
                {retention.documentDays} days and your photo after {retention.photoDays} days.
              </li>
            )}
          </ul>
        </DialogContent>
      </Dialog>
    </section>
  );
}

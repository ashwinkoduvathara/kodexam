import { Info, LockKeyhole } from "lucide-react";

export function CheckInfoBanner() {
  return (
    <div className="flex items-center gap-3.5 rounded-2xl border border-sky-100 bg-sky-50/60 px-4 py-3 short:py-2">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-sky-600 shadow-sm ring-1 ring-sky-100">
        <Info className="h-4.5 w-4.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[13px] font-bold text-navy">Why is this important?</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
          We run these quick checks to ensure a smooth and secure exam experience. All checks must
          be passed to continue.
        </p>
      </div>
      <PrivacyNote />
    </div>
  );
}

/** Screen 1 never records or uploads media: preview and audio analysis stay on-device. */
function PrivacyNote() {
  return (
    <p className="flex max-w-[360px] shrink-0 items-start gap-2 border-l border-sky-100 pl-4 text-[11px] leading-snug text-slate-600">
      <LockKeyhole className="mt-px h-3.5 w-3.5 shrink-0 text-sky-600" aria-hidden />
      <span>
        Camera and microphone access is used only for exam verification and proctoring. Your browser
        permissions remain under your control.
      </span>
    </p>
  );
}

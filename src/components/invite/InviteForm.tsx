import { useId, useState, type ComponentType, type FormEvent } from "react";
import {
  AlertCircle,
  ArrowRight,
  ChevronRight,
  GraduationCap,
  Info,
  KeyRound,
  Loader2,
  Mail,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest, ExamApiError } from "@/lib/exam/api-client";
import { cn } from "@/lib/utils";
import {
  normalizeInviteCode,
  type VerifyInviteRequest,
  type VerifyInviteResponse,
} from "@/types/invite";

type Field = "fullName" | "email" | "code";

function validate(values: VerifyInviteRequest): Partial<Record<Field, string>> {
  const errors: Partial<Record<Field, string>> = {};
  if (values.fullName.trim().length < 2)
    errors.fullName = "Enter your full name as per the invitation.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
    errors.email = "Enter the email address the invitation was sent to.";
  }
  if (!normalizeInviteCode(values.code))
    errors.code = "Enter the invite code in the format KP-XXXX-XXXX.";
  return errors;
}

function TextField({
  id,
  label,
  icon: Icon,
  error,
  hint,
  ...input
}: {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  error?: string;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div>
      <label htmlFor={id} className="text-sm font-bold text-navy">
        {label}{" "}
        <span className="text-red-500" aria-hidden>
          *
        </span>
      </label>
      <div
        className={cn(
          "mt-2 flex h-[52px] items-center gap-3 rounded-xl border bg-white px-3 transition-colors focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20",
          error ? "border-red-300" : "border-slate-200",
        )}
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-50 text-navy">
          <Icon className="h-4.5 w-4.5" aria-hidden />
        </span>
        <input
          id={id}
          required
          aria-required="true"
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy || undefined}
          className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-navy outline-none placeholder:text-slate-400"
          {...input}
        />
      </div>
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-2 text-[13px] text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p
          id={`${id}-error`}
          className="mt-2 flex items-center gap-1.5 text-[13px] font-semibold text-red-700"
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}

const NOTES = [
  "This examination is for invited candidates only.",
  "Use the exact email address and invite code shared with you.",
  "The invitation code is unique and time bound.",
  "You will be redirected to the examination process after verification.",
  "Do not share your invite code with anyone.",
];

/** Invite verification form. The server decides everything; nothing is kept in browser storage. */
export function InviteForm({ lmsUrl }: { lmsUrl: string | null }) {
  const uid = useId();
  const [values, setValues] = useState<VerifyInviteRequest>({ fullName: "", email: "", code: "" });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const set = (field: Field) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setValues((v) => ({ ...v, [field]: e.target.value }));
    if (errors[field]) setErrors((x) => ({ ...x, [field]: undefined }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setServerError(null);
    const found = validate(values);
    setErrors(found);
    if (Object.keys(found).length) {
      document.getElementById(`${uid}-${Object.keys(found)[0]}`)?.focus();
      return;
    }
    setPending(true);
    try {
      const res = await apiRequest<VerifyInviteResponse>("POST", "/api/invites/verify", {
        json: {
          fullName: values.fullName.trim(),
          email: values.email.trim(),
          code: normalizeInviteCode(values.code) ?? values.code,
        },
      });
      // Full navigation so the exam flow loads with the new HttpOnly session cookie.
      window.location.assign(res.redirectTo);
    } catch (error) {
      setServerError(
        error instanceof ExamApiError ? error.message : "Something went wrong. Please try again.",
      );
      setPending(false);
    }
  };

  return (
    <section
      aria-labelledby="invite-form-heading"
      className="rounded-2xl border border-slate-200/70 bg-white px-6 py-8 shadow-sm sm:px-10"
    >
      <h2 id="invite-form-heading" className="text-[26px] font-extrabold tracking-tight text-navy">
        Access Your Examination
      </h2>
      <p className="mt-1.5 text-[15px] text-slate-600">
        Please enter your details and the exam invite code to continue.
      </p>

      <form noValidate onSubmit={(e) => void submit(e)} className="mt-6 flex flex-col gap-5">
        <TextField
          id={`${uid}-fullName`}
          label="Full name"
          icon={UserRound}
          placeholder="Enter your full name as per the invitation"
          autoComplete="name"
          value={values.fullName}
          onChange={set("fullName")}
          error={errors.fullName}
          maxLength={200}
        />
        <TextField
          id={`${uid}-email`}
          label="Email address"
          icon={Mail}
          type="email"
          placeholder="Enter your invited email address"
          autoComplete="email"
          value={values.email}
          onChange={set("email")}
          error={errors.email}
          maxLength={320}
        />
        <TextField
          id={`${uid}-code`}
          label="Exam invite code"
          icon={KeyRound}
          placeholder="e.g. KP-XXXX-XXXX"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={values.code}
          onChange={set("code")}
          error={errors.code}
          hint="Use the code provided by your exam coordinator."
          maxLength={20}
        />

        {serverError && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50/80 px-4 py-3 text-sm font-semibold text-red-800"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {serverError}
          </p>
        )}

        <Button
          type="submit"
          disabled={pending}
          className="h-[52px] rounded-xl text-[15px] font-bold shadow-[0_8px_20px_-10px] shadow-brand/60"
        >
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {pending ? "Verifying…" : "Verify Invite & Continue"}
          {!pending && <ArrowRight aria-hidden />}
        </Button>
        <p className="sr-only" aria-live="polite">
          {pending ? "Verifying your invitation…" : ""}
        </p>
      </form>

      <div className="mt-6 flex gap-4 rounded-xl border border-sky-100 bg-sky-50/70 px-5 py-4">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sky-600 text-white">
          <Info className="h-4.5 w-4.5" aria-hidden />
        </span>
        <div>
          <h3 className="text-sm font-bold text-navy">Important Information</h3>
          <ul className="mt-2 space-y-1.5">
            {NOTES.map((n) => (
              <li
                key={n}
                className="flex items-start gap-2.5 text-[13px] leading-snug text-slate-700"
              >
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-600" aria-hidden />
                {n}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div
        className="my-6 flex items-center gap-4 text-xs font-semibold text-slate-400"
        aria-hidden
      >
        <span className="h-px flex-1 bg-slate-200" />
        OR
        <span className="h-px flex-1 bg-slate-200" />
      </div>

      {lmsUrl ? (
        <a
          href={lmsUrl}
          className="group flex items-center gap-4 rounded-xl border border-slate-200 px-5 py-4 transition-colors hover:border-brand/40 hover:bg-brand-soft/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          <StudentCopy />
          <ChevronRight
            className="h-5 w-5 shrink-0 text-navy transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </a>
      ) : (
        <div className="flex items-center gap-4 rounded-xl border border-slate-200 px-5 py-4">
          <StudentCopy text="Open your exam from your Kodeversity dashboard." />
        </div>
      )}
    </section>
  );
}

function StudentCopy({
  text = "Sign in with your LMS account to access your exams",
}: {
  text?: string;
}) {
  return (
    <>
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate-100 text-navy">
        <GraduationCap className="h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-navy">I am a Kodeversity student</span>
        <span className="mt-0.5 block text-[13px] text-slate-600">{text}</span>
      </span>
    </>
  );
}

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

interface CandidateAcknowledgementProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  label?: string;
  note?: string;
}

export function CandidateAcknowledgement({
  checked,
  onCheckedChange,
  disabled,
  id = "instructions-acknowledgement",
  label = "I have read and understood the examination instructions and agree to follow the examination rules.",
  note = "Any violation of these instructions may result in disqualification from the examination.",
}: CandidateAcknowledgementProps) {
  const noteId = `${id}-note`;
  return (
    <div
      className={cn(
        "flex items-start gap-3.5 rounded-2xl border px-5 py-3.5 transition-colors short:py-3",
        checked ? "border-brand/25 bg-brand-soft/60" : "border-sky-100 bg-sky-50/60",
        disabled && "opacity-60",
      )}
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        disabled={disabled}
        aria-describedby={noteId}
        className="mt-0.5 h-5 w-5 rounded-md border-slate-300 bg-white data-[state=checked]:border-brand [&_svg]:h-3.5 [&_svg]:w-3.5"
      />
      <div>
        <label
          htmlFor={id}
          className={cn(
            "text-sm font-bold text-navy",
            disabled ? "cursor-not-allowed" : "cursor-pointer",
          )}
        >
          {label}
        </label>
        <p id={noteId} className="mt-1 text-xs text-slate-600">
          {note}
        </p>
      </div>
    </div>
  );
}

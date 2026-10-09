import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface InstructionFooterProps {
  canContinue: boolean;
  pending: boolean;
  onBack: () => void;
  onContinue: () => void;
  continueLabel?: string;
  backLabel?: string;
}

export function InstructionFooter({
  canContinue,
  pending,
  onBack,
  onContinue,
  continueLabel = "I Understand, Continue",
  backLabel = "Back to System Check",
}: InstructionFooterProps) {
  const enabled = canContinue && !pending;
  return (
    <div className="flex items-center justify-between gap-4">
      <Button
        variant="outline"
        onClick={onBack}
        disabled={pending}
        className="h-11 rounded-xl border-slate-200 bg-white px-5 text-sm font-bold text-navy shadow-sm"
      >
        <ArrowLeft aria-hidden />
        {backLabel}
      </Button>
      <Button
        onClick={onContinue}
        disabled={!enabled}
        className={cn(
          "h-11 min-w-[240px] rounded-xl px-7 text-sm font-bold",
          enabled
            ? "shadow-[0_8px_20px_-10px] shadow-brand/60"
            : "disabled:bg-brand/35 disabled:opacity-100 disabled:shadow-none",
        )}
      >
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        {continueLabel}
        {!pending && <ArrowRight aria-hidden />}
      </Button>
    </div>
  );
}

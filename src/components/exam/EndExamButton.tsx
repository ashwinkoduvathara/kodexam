import { useState } from "react";
import { AlertCircle, Loader2, LogOut } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { EndAttemptResult } from "@/lib/exam/session/exam-session-service";

interface EndExamButtonProps {
  /** Calls the session service; the dialog only closes when the server confirms. */
  onEndExam: () => Promise<EndAttemptResult>;
  onEnded: () => void;
  /** "submit" once the exam is running: ending it submits the saved answers. */
  mode?: "end" | "submit";
}

const COPY = {
  end: {
    title: "End Examination?",
    description:
      "Are you sure you want to leave this examination? Your current attempt may be terminated.",
    confirm: "End Exam",
  },
  submit: {
    title: "Submit and end the exam?",
    description:
      "Your saved answers will be submitted and the exam will end. You won't be able to change your answers afterwards. Any answer you haven't saved won't be included.",
    confirm: "Submit & End Exam",
  },
} as const;

export function EndExamButton({ onEndExam, onEnded, mode = "end" }: EndExamButtonProps) {
  const copy = COPY[mode];
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setPending(true);
    setError(null);
    try {
      const result = await onEndExam();
      if (result.ok) {
        setOpen(false);
        onEnded();
      } else {
        setError(result.message);
      }
    } catch {
      setError("We couldn't reach the exam server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          className="h-9 rounded-xl border-red-200 px-3.5 text-xs font-bold text-red-600 shadow-none hover:bg-red-50 hover:text-red-700"
        >
          End Exam
          <LogOut aria-hidden />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="kp max-w-md rounded-2xl border-slate-200 bg-white p-6">
        <AlertDialogHeader>
          <span className="mb-1 grid h-11 w-11 place-items-center rounded-xl bg-red-50 text-red-600">
            <LogOut className="h-5 w-5" aria-hidden />
          </span>
          <AlertDialogTitle className="text-lg font-extrabold text-navy">
            {copy.title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm leading-relaxed text-slate-600">
            {copy.description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50/70 px-3 py-2.5 text-xs leading-relaxed text-red-800"
          >
            <AlertCircle className="mt-px h-4 w-4 shrink-0" aria-hidden />
            {error}
          </p>
        )}
        <AlertDialogFooter className="mt-2 gap-2">
          <AlertDialogCancel
            disabled={pending}
            className="h-10 rounded-xl text-xs font-bold text-navy"
          >
            Cancel
          </AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={() => void handleConfirm()}
            disabled={pending}
            className="h-10 rounded-xl text-xs font-bold"
          >
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {copy.confirm}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

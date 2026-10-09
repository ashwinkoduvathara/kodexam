import { AudioLines, Play, RotateCcw, Volume1, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useSpeakerCheck } from "@/hooks/use-speaker-check";
import { useCheckReporting, type CheckReporter } from "@/hooks/use-system-readiness";
import {
  CheckAction,
  CheckWell,
  CheckWellLabel,
  InlineCheckMessage,
  SystemCheckCard,
} from "./SystemCheckCard";

export function SpeakerCheck({ reporter }: { reporter: CheckReporter }) {
  const { state, phase, volume, setVolume, play, confirm, probe } = useSpeakerCheck();

  useCheckReporting(reporter, "speaker", state, probe);

  const playing = phase === "playing";
  const percent = Math.round(volume * 100);
  const firstPlay = phase === "idle" && state.reason !== "retest_needed";

  return (
    <SystemCheckCard
      checkId="speaker"
      icon={Volume2}
      issueIcon={VolumeX}
      title="Speaker"
      description="Check if you can hear the sound clearly."
      state={state}
      inlineIssue
      footer={
        <CheckAction
          icon={playing ? AudioLines : firstPlay ? Play : RotateCcw}
          emphasis={phase === "idle" || phase === "not_heard"}
          disabled={playing || phase === "confirming"}
          onClick={() => void play()}
          className={playing ? "[&_svg]:animate-pulse" : undefined}
        >
          {playing ? "Playing…" : firstPlay ? "Play Test Sound" : "Play Again"}
        </CheckAction>
      }
    >
      <CheckWell>
        <CheckWellLabel
          aside={
            <span className="text-[10px] font-bold tabular-nums text-slate-600" aria-hidden>
              {percent}%
            </span>
          }
        >
          <span id="speaker-volume-label">Volume Level</span>
        </CheckWellLabel>

        <div className="mt-3.5 flex items-center gap-2.5">
          <Volume1 className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          <Slider
            value={[percent]}
            min={5}
            max={100}
            step={1}
            onValueChange={([v]) => setVolume(v / 100)}
            aria-labelledby="speaker-volume-label"
            className="[&_[role=slider]]:h-4 [&_[role=slider]]:w-4 [&_[role=slider]]:border-brand [&_[role=slider]]:bg-white [&_[role=slider]]:focus-visible:ring-2"
          />
          <Volume2 className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
        </div>

        <div className="mt-auto pt-3">
          {phase === "confirming" ? (
            <div
              className="rounded-lg border border-slate-200/80 bg-white p-2.5"
              role="group"
              aria-labelledby="speaker-confirm-label"
            >
              <p id="speaker-confirm-label" className="text-[11px] font-bold text-navy">
                Did you hear the test sound?
              </p>
              <div className="mt-2 flex gap-1.5">
                <Button
                  size="sm"
                  onClick={() => confirm(true)}
                  className="h-8 flex-1 rounded-lg px-2 text-[11px] font-bold"
                  autoFocus
                >
                  Yes, I heard it
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => confirm(false)}
                  className="h-8 flex-1 rounded-lg border-slate-200 px-2 text-[11px] font-bold text-slate-700 shadow-none"
                >
                  No, try again
                </Button>
              </div>
            </div>
          ) : state.message ? (
            <InlineCheckMessage
              tone={state.status === "failed" ? "danger" : "warning"}
              {...state.message}
            />
          ) : (
            <p className="text-[11px] leading-relaxed text-slate-600">
              {phase === "passed"
                ? "Sound confirmed. Your speakers are working."
                : playing
                  ? "Listen for a short three-note chime…"
                  : "Play the test sound and confirm that you can hear it."}
            </p>
          )}
        </div>
      </CheckWell>
    </SystemCheckCard>
  );
}

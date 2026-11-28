import { useEffect, useRef, type ReactNode } from "react";
import { useVoice } from "../hooks/useVoice";
import { Button } from "./Button";
import { ListeningPanel } from "./ListeningPanel";
import { VoicePrompt } from "./VoicePrompt";

/**
 * The voice controls pinned to the bottom of a game page (action-decision.md
 * section 3.3), in one compact row with the game's own actions; prompts and
 * choices appear above that row only while a turn needs them.
 */
export function VoiceBar({ actions }: { actions?: ReactNode }): React.JSX.Element {
  const voice = useVoice();
  const { phase, setActive } = voice;
  const cancel = useRef(voice.cancel);
  useEffect(() => {
    cancel.current = voice.cancel;
  });
  /* Voice is active only while this bar is on screen; leaving the game ends any turn in progress. */
  useEffect(() => {
    setActive(true);
    return () => {
      setActive(false);
      cancel.current();
    };
  }, [setActive]);
  const idle =
    phase === "IDLE" || phase === "PROPOSAL" || phase === "CHOICES" || phase === "CONFIRM_APP";
  return (
    <section
      aria-label="Voice control"
      className="fixed inset-x-0 bottom-0 z-20 border-t-2 border-line bg-surface px-3 py-2"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-2">
        {phase === "LISTENING" ? (
          <ListeningPanel
            onSubmit={voice.submit}
            onCancel={voice.cancel}
            recording={voice.recording}
            onStop={voice.stopRecording}
            heard={voice.heardSoFar}
          />
        ) : null}
        <VoicePrompt />
        <div className="flex flex-wrap items-center gap-2">
          <p aria-live="polite" className="mr-auto min-h-7 min-w-0 flex-1 text-lg font-semibold">
            {phase === "DECIDING" ? "Thinking..." : voice.message}
          </p>
          {idle ? (
            <div data-help-id="talk">
              <Button size="compact" className="min-w-40" onClick={voice.startListening}>
                Talk (Space)
              </Button>
            </div>
          ) : null}
          {actions}
        </div>
      </div>
    </section>
  );
}

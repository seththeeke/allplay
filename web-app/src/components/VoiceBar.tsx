import { useEffect, useRef, type ReactNode } from "react";
import { useVoice } from "../hooks/useVoice";
import type { AppAction } from "../models/api";
import { Button } from "./Button";
import { ListeningPanel } from "./ListeningPanel";

const CONFIRM_TEXT: Partial<Record<AppAction["action"], string>> = {
  NEW_GAME: "Start a new game?",
  SIGN_IN: "Go to sign in?",
  SIGN_OUT: "Sign out?",
};

/**
 * The voice controls pinned to the bottom of a game page (action-decision.md
 * section 3.3), in one compact row with the game's own actions; prompts and
 * choices appear above that row only while a turn needs them.
 */
export function VoiceBar({ actions }: { actions?: ReactNode }): React.JSX.Element {
  const voice = useVoice();
  const { phase, decision, setActive } = voice;
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
  const confirmText = decision?.appAction
    ? (CONFIRM_TEXT[decision.appAction.action] ?? "Are you sure?")
    : null;
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
          />
        ) : null}
        {phase === "PROPOSAL" || phase === "CONFIRM_APP" ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="mr-auto text-2xl font-bold">
              {phase === "CONFIRM_APP" ? confirmText : decision?.proposal?.text}
            </p>
            <Button size="compact" onClick={voice.confirm}>
              Confirm (Enter)
            </Button>
            <Button size="compact" variant="secondary" onClick={voice.cancel}>
              Cancel (Esc)
            </Button>
          </div>
        ) : null}
        {phase === "CHOICES" ? (
          <div className="flex flex-wrap items-center gap-2">
            {voice.choices.map((choice) => (
              <Button
                key={choice.number}
                size="compact"
                variant="secondary"
                onClick={() => {
                  voice.choose(choice.number);
                }}
              >
                {choice.number}. {choice.text}
              </Button>
            ))}
            <Button size="compact" variant="quiet" onClick={voice.cancel}>
              Cancel (Esc)
            </Button>
          </div>
        ) : null}
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

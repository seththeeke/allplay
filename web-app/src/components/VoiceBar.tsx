import { useEffect, useRef } from "react";
import { useVoice } from "../hooks/useVoice";
import type { AppAction } from "../models/api";
import { Button } from "./Button";
import { ListeningPanel } from "./ListeningPanel";

const CONFIRM_TEXT: Partial<Record<AppAction["action"], string>> = {
  NEW_GAME: "Start a new game?",
  SIGN_IN: "Go to sign in?",
  SIGN_OUT: "Sign out?",
};

/** The voice controls pinned to the bottom of a game page (action-decision.md section 3.3). */
export function VoiceBar(): React.JSX.Element {
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
  return (
    <section
      aria-label="Voice control"
      className="fixed inset-x-0 bottom-0 z-20 border-t-4 border-line bg-surface p-3"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-3">
        <p aria-live="polite" className="min-h-8 text-2xl font-semibold">
          {phase === "DECIDING" ? "Thinking..." : voice.message}
        </p>
        {phase === "LISTENING" ? (
          <ListeningPanel
            onSubmit={voice.submit}
            onCancel={voice.cancel}
            recording={voice.recording}
            onStop={voice.stopRecording}
          />
        ) : null}
        {phase === "PROPOSAL" || phase === "CONFIRM_APP" ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="mr-auto text-3xl font-bold">
              {phase === "CONFIRM_APP" ? confirmText : decision?.proposal?.text}
            </p>
            <Button onClick={voice.confirm}>Confirm (Enter)</Button>
            <Button variant="secondary" onClick={voice.cancel}>
              Cancel (Esc)
            </Button>
          </div>
        ) : null}
        {phase === "CHOICES" ? (
          <div className="flex flex-wrap items-center gap-3">
            {voice.choices.map((choice) => (
              <Button
                key={choice.number}
                variant="secondary"
                onClick={() => {
                  voice.choose(choice.number);
                }}
              >
                {choice.number}. {choice.text}
              </Button>
            ))}
            <Button variant="quiet" onClick={voice.cancel}>
              Cancel (Esc)
            </Button>
          </div>
        ) : null}
        {phase === "IDLE" ||
        phase === "PROPOSAL" ||
        phase === "CHOICES" ||
        phase === "CONFIRM_APP" ? (
          <div data-help-id="talk" className="w-fit">
            <Button className="w-full sm:w-auto sm:min-w-72" onClick={voice.startListening}>
              Talk (Space)
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

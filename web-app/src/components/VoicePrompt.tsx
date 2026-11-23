import { useVoice } from "../hooks/useVoice";
import type { AppAction } from "../models/api";
import { Button } from "./Button";

const CONFIRM_TEXT: Partial<Record<AppAction["action"], string>> = {
  NEW_GAME: "Start a new game?",
  SIGN_IN: "Go to sign in?",
  SIGN_OUT: "Sign out?",
};

/** The waiting confirmation or numbered choices, shared by both voice modes. */
export function VoicePrompt(): React.JSX.Element | null {
  const voice = useVoice();
  const { phase, decision } = voice;
  if (phase === "PROPOSAL" || phase === "CONFIRM_APP") {
    const confirmText = decision?.appAction
      ? (CONFIRM_TEXT[decision.appAction.action] ?? "Are you sure?")
      : null;
    return (
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
    );
  }
  if (phase !== "CHOICES") return null;
  return (
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
  );
}

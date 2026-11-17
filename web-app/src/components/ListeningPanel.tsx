import { useEffect, useRef, useState } from "react";
import { Button } from "./Button";

export interface ListeningPanelProps {
  onSubmit: (transcript: string) => void;
  onCancel: () => void;
}

/**
 * Prototype stand-in for microphone capture: the player types what they would
 * say. Live mode streams speech to Amazon Transcribe (action-decision.md section 3).
 */
export function ListeningPanel({ onSubmit, onCancel }: ListeningPanelProps): React.JSX.Element {
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  /* Listening starts on purpose (Space or Talk), so the field takes focus right away. */
  useEffect(() => {
    input.current?.focus();
  }, []);
  return (
    <form
      className="flex flex-wrap items-center gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(text);
      }}
    >
      <label htmlFor="voice-input" className="text-2xl font-bold">
        Listening. Say what you want to do:
      </label>
      <input
        id="voice-input"
        ref={input}
        autoComplete="off"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
        className="min-h-14 min-w-64 flex-1 rounded-xl border-4 border-accent bg-surface px-4 text-2xl"
      />
      <Button type="submit">Done</Button>
      <Button variant="secondary" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

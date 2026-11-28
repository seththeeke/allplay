import { useEffect, useRef, useState } from "react";
import { Button } from "./Button";

export interface ListeningPanelProps {
  onSubmit: (transcript: string) => void;
  onCancel: () => void;
  /** The microphone is capturing (local-development.md section 5). */
  recording?: boolean;
  onStop?: () => void;
  /** Partial text as the player speaks (productionalization.md section 9). */
  heard?: string;
}

/**
 * The listening state. With a microphone the player speaks and presses Space
 * (the focused Stop button) or Done; a typed command is always accepted, and
 * is the only input when no microphone is configured.
 */
export function ListeningPanel({
  onSubmit,
  onCancel,
  recording = false,
  onStop,
  heard = "",
}: ListeningPanelProps): React.JSX.Element {
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const stop = useRef<HTMLButtonElement>(null);
  /* Listening starts on purpose (Space or Talk), so the active control takes focus right away. */
  useEffect(() => {
    if (recording) stop.current?.focus();
    else input.current?.focus();
  }, [recording]);
  return (
    <form
      className="flex flex-wrap items-center gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (recording && text.trim() === "") onStop?.();
        else onSubmit(text);
      }}
    >
      {recording ? (
        <>
          <p role="status" className="flex w-full items-center gap-3 text-2xl font-bold">
            <span
              aria-hidden="true"
              data-testid="recording-indicator"
              className="ap-listening-pulse inline-block size-5 rounded-full border-2 border-ink bg-accent"
            />
            <span>
              Listening
              <span aria-hidden="true" className="ap-listening-dots" />
            </span>
            <span className="font-semibold">Speak now, then press Space.</span>
          </p>
          {heard === "" ? null : (
            <p className="w-full text-2xl" data-testid="heard-so-far">
              Heard: <span className="font-semibold">{heard}</span>
            </p>
          )}
          <Button ref={stop} type="button" onClick={onStop}>
            Stop (Space)
          </Button>
        </>
      ) : null}
      <label htmlFor="voice-input" className="text-2xl font-bold">
        {recording ? "Or type it:" : "Listening. Say what you want to do:"}
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

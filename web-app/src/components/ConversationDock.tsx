import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { useVoice } from "../hooks/useVoice";
import { useConversation } from "../voice/useConversation";
import { Button } from "./Button";
import { VoiceOrb } from "./VoiceOrb";
import { VoicePrompt } from "./VoicePrompt";

export interface ConversationDockProps {
  sessionId: string | null;
  /** False while something else needs the player, such as the first-game tour. */
  ready: boolean;
  actions?: ReactNode;
}

/**
 * Conversational voice on the game screen (conversational-ai.md section 8):
 * the orb, a prompt only while one waits, game actions, and typed commands
 * for anyone who cannot or would rather not speak.
 */
export function ConversationDock({
  sessionId,
  ready,
  actions,
}: ConversationDockProps): React.JSX.Element {
  const voice = useVoice();
  const conversation = useConversation(sessionId, ready);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const field = useRef<HTMLInputElement>(null);
  /* The field opens on purpose, from the Type button, so it takes focus right away. */
  useEffect(() => {
    if (typing) field.current?.focus();
  }, [typing]);
  const send = (event: SyntheticEvent): void => {
    event.preventDefault();
    if (text.trim() === "") return;
    voice.submit(text);
    setText("");
    setTyping(false);
  };
  return (
    <section aria-label="Voice control">
      <p aria-live="polite" className="sr-only">
        {conversation.status}
      </p>
      <VoiceOrb
        state={conversation.orb}
        paused={conversation.paused}
        onPress={conversation.togglePaused}
      />
      {conversation.greeting === null ? null : (
        <p className="ap-orb-greeting font-bold">{conversation.greeting}</p>
      )}
      <div className="pointer-events-none fixed right-3 bottom-3 left-24 z-20 flex flex-col items-end gap-2">
        <div className="pointer-events-auto flex max-w-full flex-col gap-2 rounded-xl bg-surface empty:hidden">
          <VoicePrompt />
        </div>
        {typing ? (
          <form onSubmit={send} className="pointer-events-auto flex max-w-full flex-wrap gap-2">
            <label htmlFor="voice-command" className="sr-only">
              Type a command
            </label>
            <input
              id="voice-command"
              ref={field}
              autoComplete="off"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
              }}
              className="min-h-12 min-w-48 flex-1 rounded-xl border-4 border-accent bg-surface px-3 text-xl"
            />
            <Button type="submit" size="compact">
              Send
            </Button>
          </form>
        ) : null}
        <div className="pointer-events-auto flex flex-wrap justify-end gap-2">
          <Button
            size="compact"
            variant="secondary"
            aria-expanded={typing}
            onClick={() => {
              setTyping((open) => !open);
            }}
          >
            Type
          </Button>
          {actions}
        </div>
      </div>
    </section>
  );
}

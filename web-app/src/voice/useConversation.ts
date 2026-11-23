import { useEffect, useRef, useState } from "react";
import { usePreferences } from "../hooks/usePreferences";
import { useServices } from "../hooks/useServices";
import { useVoice } from "../hooks/useVoice";
import type { ContinuousListener } from "./continuousListeners";

export type OrbState = "GREETING" | "IDLE" | "HEARING" | "THINKING" | "SPEAKING" | "PAUSED";

/** A greeting that never reports its end (blocked audio) must not hold the microphone shut. */
export const GREETING_MAX_MS = 8_000;

export interface Conversation {
  orb: OrbState;
  /** What assistive technology announces for the current state. */
  status: string;
  greeting: string | null;
  paused: boolean;
  /** The microphone could not be opened, so only typing works. */
  micUnavailable: boolean;
  togglePaused: () => void;
}

/**
 * Continuous conversation on the game screen (conversational-ai.md section
 * 3): greets once per session, then listens until the player leaves, pauses
 * or hides the tab. Heard utterances are decided strictly one at a time.
 */
export function useConversation(sessionId: string | null, ready: boolean): Conversation {
  const voice = useVoice();
  const { decisions, speechInput } = useServices();
  const { preferences } = usePreferences();
  const latest = useRef(voice);
  const mounted = useRef(true);
  const greetedId = useRef<string | null>(null);
  const listener = useRef<ContinuousListener | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [greeting, setGreeting] = useState<string | null>(null);
  const [greeted, setGreeted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hearing, setHearing] = useState(false);
  const [micUnavailable, setMicUnavailable] = useState(false);
  const [visible, setVisible] = useState(document.visibilityState !== "hidden");
  const { setActive, speaking, phase } = voice;
  const silenceMs = preferences.listenTimeoutMs;
  const silence = useRef(silenceMs);

  useEffect(() => {
    latest.current = voice;
    silence.current = silenceMs;
  });

  const togglePaused = (): void => {
    setPaused((current) => !current);
    setHearing(false);
  };
  const toggle = useRef(togglePaused);
  useEffect(() => {
    toggle.current = togglePaused;
  });

  /* Voice is active only while this dock is on screen; leaving the game ends any turn. */
  useEffect(() => {
    mounted.current = true;
    setActive(true);
    latest.current.setSpaceHandler(() => {
      toggle.current();
    });
    return () => {
      mounted.current = false;
      setActive(false);
      latest.current.setSpaceHandler(null);
      latest.current.cancel();
    };
  }, [setActive]);

  useEffect(() => {
    const onChange = (): void => {
      setVisible(document.visibilityState !== "hidden");
    };
    document.addEventListener("visibilitychange", onChange);
    return () => {
      document.removeEventListener("visibilitychange", onChange);
    };
  }, []);

  useEffect(() => {
    if (!ready || sessionId === null || greetedId.current === sessionId) return;
    greetedId.current = sessionId;
    setGreeted(false);
    const done = (): void => {
      if (greetedId.current !== sessionId) return;
      setGreeting(null);
      setGreeted(true);
    };
    setTimeout(done, GREETING_MAX_MS);
    void decisions
      .greet(sessionId)
      .then(({ text }) => {
        if (!mounted.current) return;
        setGreeting(text);
        latest.current.speakLine(text, done);
      })
      .catch(done);
  }, [ready, sessionId, decisions]);

  const listening = ready && greeted && !paused && visible;
  useEffect(() => {
    if (!listening || !speechInput.listen) return undefined;
    let cancelled = false;
    void speechInput
      .listen(
        {
          onSpeechStart: () => {
            setHearing(true);
            latest.current.stopSpeaking();
          },
          onNothing: () => {
            setHearing(false);
          },
          onError: () => {
            setHearing(false);
          },
          onHeard: (heard) => {
            setHearing(false);
            queue.current = queue.current.then(() => latest.current.submitHeard(heard));
          },
        },
        silence.current,
      )
      .then((started) => {
        if (cancelled) started.stop();
        else {
          listener.current = started;
          setMicUnavailable(false);
        }
      })
      .catch(() => {
        if (!cancelled) setMicUnavailable(true);
      });
    return () => {
      cancelled = true;
      listener.current?.stop();
      listener.current = null;
      setHearing(false);
    };
  }, [listening, speechInput]);

  useEffect(() => {
    listener.current?.setSpeaking(speaking);
  }, [speaking]);
  useEffect(() => {
    listener.current?.setSilenceMs(silenceMs);
  }, [silenceMs]);

  const inactive = paused || micUnavailable || !speechInput.listen;
  /* The orb is large from the moment the game is ready, before the greeting's words arrive. */
  const orb: OrbState =
    greeting !== null || (ready && !greeted)
      ? "GREETING"
      : speaking
        ? "SPEAKING"
        : phase === "DECIDING"
          ? "THINKING"
          : inactive
            ? "PAUSED"
            : hearing
              ? "HEARING"
              : "IDLE";
  const STATUS: Record<OrbState, string> = {
    GREETING: greeting ?? "Starting your game",
    IDLE: "Listening for your voice",
    HEARING: "Hearing you",
    THINKING: "Working on it",
    SPEAKING: voice.message ?? "Speaking",
    PAUSED: micUnavailable ? "Microphone unavailable. Type a command." : "Listening paused",
  };
  return { orb, status: STATUS[orb], greeting, paused, micUnavailable, togglePaused };
}

import { useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { usePreferences } from "../hooks/usePreferences";
import { useServices } from "../hooks/useServices";
import {
  CONFIRMED_APP_ACTIONS,
  type DecisionResponse,
  type ResolutionRequest,
  type Screen,
  type SessionEnvelope,
  type TranscriptSource,
} from "../models/api";
import type { Heard, SpeechCapture } from "./speechInput";
import type { SpeechOutput } from "./speechOutput";
import { pendingPromptOf, resolutionFor } from "./turns";
import { useAppActions } from "./useAppActions";
import { useVoiceKeys } from "./useVoiceKeys";
import {
  VoiceContext,
  type VoiceControls,
  type VoiceGameTarget,
  type VoicePhase,
} from "./VoiceContext";

const SCREENS: Record<string, Screen> = {
  "/": "HOME",
  "/stats": "STATS",
  "/settings": "SETTINGS",
  "/help": "HELP",
};

export interface VoiceProviderProps {
  children: ReactNode;
  speech?: SpeechOutput;
  now?: () => number;
}

/** Capture stops by itself after this long (action-decision.md section 3.1). */
export const MAX_CAPTURE_MS = 10_000;

/**
 * The voice turn state machine (action-decision.md section 2): listen, decide,
 * then propose, offer choices, confirm an application action, or act.
 */
export function VoiceProvider({
  children,
  speech,
  now = () => performance.now(),
}: VoiceProviderProps): React.JSX.Element {
  const services = useServices();
  const { decisions, speechInput } = services;
  const output = speech ?? services.speechOutput;
  const { preferences } = usePreferences();
  const { pathname } = useLocation();
  const [phase, setPhase] = useState<VoicePhase>("IDLE");
  const [decision, setDecisionState] = useState<DecisionResponse | null>(null);
  /* Queued utterances run before React renders, so the waiting prompt is read from here. */
  const currentDecision = useRef<DecisionResponse | null>(null);
  const setDecision = (next: DecisionResponse | null): void => {
    currentDecision.current = next;
    setDecisionState(next);
  };
  const [speaking, setSpeaking] = useState(false);
  const speechTurn = useRef(0);
  const spaceHandler = useRef<(() => void) | null>(null);
  const conversational = preferences.voiceMode === "CONVERSATIONAL";
  const [message, setMessage] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const target = useRef<VoiceGameTarget | null>(null);
  const captureEnded = useRef(0);
  const capture = useRef<SpeechCapture | null>(null);
  const captureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recording, setRecording] = useState(false);

  const speakLine = (spoken: string, onEnd?: () => void): void => {
    speechTurn.current += 1;
    const mine = speechTurn.current;
    setSpeaking(true);
    output.speak(spoken, preferences.speechRate, preferences.voiceId, () => {
      if (mine === speechTurn.current) setSpeaking(false);
      onEnd?.();
    });
  };
  const say = (text: string, spoken: string = text, force = false): void => {
    setMessage(text);
    if (conversational) speakLine(spoken);
    else if (force || preferences.voiceOutputEnabled)
      output.speak(spoken, preferences.speechRate, preferences.voiceId);
  };
  /* The next queued utterance needs the new version before the page re-renders. */
  const showSession = (session: SessionEnvelope): void => {
    if (target.current === null) return;
    target.current = { ...target.current, version: session.session.version };
    target.current.replace(session);
  };
  const latency = (): number => Math.max(0, Math.round(now() - captureEnded.current));
  const restingPhase = (current: DecisionResponse | null): VoicePhase => {
    if (current === null) return "IDLE";
    if (current.outcome === "CHOICES") return "CHOICES";
    return current.outcome === "PROPOSED" ? "PROPOSAL" : "CONFIRM_APP";
  };
  const runApp = useAppActions(
    () => {
      if (message !== null) say(message, message, true);
    },
    () => target.current,
  );

  const finish = (
    resolution: ResolutionRequest["resolution"],
    optionNumber: number | null = null,
  ): void => {
    const current = currentDecision.current;
    setPhase("IDLE");
    setDecision(null);
    if (current === null) return;
    const request = {
      ...resolutionFor(current, resolution, target.current, latency(), optionNumber),
      ...(conversational ? { voiceMode: "CONVERSATIONAL" as const } : {}),
    };
    void decisions
      .resolve(current.decisionId, request)
      .then((result) => {
        if (result.session !== null) showSession(result.session);
        if (result.speech !== undefined) say(result.speech);
        if (resolution === "CONFIRMED" && current.appAction !== null) runApp(current.appAction);
      })
      .catch(() => {
        say("That move could not be made. Please try again.");
      });
  };

  const handle = (response: DecisionResponse): void => {
    /* Side talk changes nothing, so a waiting prompt keeps waiting (conversational-ai.md section 4.2). */
    if (response.silent === true) {
      setPhase(restingPhase(currentDecision.current));
      return;
    }
    say(response.displayText, response.speech);
    if (response.session !== null) showSession(response.session);
    const confirmApp =
      response.outcome === "APP_ACTION" &&
      response.appAction !== null &&
      CONFIRMED_APP_ACTIONS.has(response.appAction.action);
    if (response.outcome === "PROPOSED" || response.outcome === "CHOICES" || confirmApp) {
      setDecision(response);
      setPhase(restingPhase(response));
      return;
    }
    setDecision(null);
    setPhase("IDLE");
    if (response.appAction !== null) runApp(response.appAction);
    if (response.outcome === "AUTO_APPLIED" || response.outcome === "APP_ACTION") {
      void decisions.resolve(
        response.decisionId,
        resolutionFor(response, "ACKNOWLEDGED", target.current, latency()),
      );
    }
  };

  const endCapture = (): SpeechCapture | null => {
    const current = capture.current;
    capture.current = null;
    if (captureTimer.current !== null) clearTimeout(captureTimer.current);
    captureTimer.current = null;
    setRecording(false);
    return current;
  };

  const stopRecording = (): void => {
    const current = endCapture();
    if (current === null) return;
    captureEnded.current = now();
    setPhase("DECIDING");
    void current
      .stop()
      .then((heard) => {
        void submit(heard.text, heard.transcriptSource);
      })
      .catch(() => {
        setPhase(restingPhase(currentDecision.current));
        say("I couldn't hear that. Please try again, or type the command.");
      });
  };

  const startCapture = (): void => {
    if (speechInput.start === null) return;
    void speechInput
      .start()
      .then((started) => {
        capture.current = started;
        setRecording(true);
        captureTimer.current = setTimeout(stopRecording, MAX_CAPTURE_MS);
      })
      .catch(() => {
        say("The microphone is not available. Type the command instead.");
      });
  };

  const submit = (
    transcript: string,
    transcriptSource: TranscriptSource = "TYPED",
  ): Promise<void> => {
    const text = transcript.trim();
    if (text.length === 0) {
      say("I didn't hear anything.");
      setPhase(restingPhase(currentDecision.current));
      return Promise.resolve();
    }
    captureEnded.current = now();
    setPhase("DECIDING");
    return decisions
      .decide({
        transcript: text,
        transcriptSource,
        context: {
          screen: SCREENS[pathname] ?? (target.current === null ? "HOME" : "GAME"),
          sessionId: target.current?.sessionId ?? null,
          expectedVersion: target.current?.version ?? null,
          pendingPrompt: pendingPromptOf(currentDecision.current),
          voiceMode: conversational ? "CONVERSATIONAL" : "TURN_BASED",
        },
      })
      .then(handle)
      .catch(() => {
        setDecision(null);
        setPhase("IDLE");
        say("Something went wrong. Please try again.");
      });
  };

  const controls: VoiceControls = {
    phase,
    decision,
    message,
    proposedActionId: phase === "PROPOSAL" ? (decision?.proposal?.actionId ?? null) : null,
    choices: phase === "CHOICES" ? (decision?.choices ?? []) : [],
    recording,
    canRecord: speechInput.start !== null,
    speaking,
    startListening: () => {
      setPhase("LISTENING");
      startCapture();
    },
    stopRecording,
    submit: (transcript) => {
      endCapture()?.cancel();
      void submit(transcript);
    },
    submitHeard: (heard: Heard) => submit(heard.text, heard.transcriptSource),
    speakLine,
    stopSpeaking: () => {
      speechTurn.current += 1;
      setSpeaking(false);
      output.stop?.();
    },
    setSpaceHandler: (handler) => {
      spaceHandler.current = handler;
    },
    confirm: () => {
      if (phase === "PROPOSAL" || phase === "CONFIRM_APP") finish("CONFIRMED");
    },
    cancel: () => {
      endCapture()?.cancel();
      if (conversational) {
        speechTurn.current += 1;
        setSpeaking(false);
        output.stop?.();
      }
      if (decision !== null && phase !== "LISTENING") {
        finish("REJECTED");
        say("Cancelled.");
      } else {
        setPhase(restingPhase(decision));
      }
    },
    choose: (number) => {
      if (
        phase === "CHOICES" &&
        (decision?.choices ?? []).some((choice) => choice.number === number)
      ) {
        finish("CHOSE_OPTION", number);
      }
    },
    setGameTarget: (next) => {
      target.current = next;
    },
    setActive,
  };
  useVoiceKeys(controls, active, spaceHandler);
  return <VoiceContext.Provider value={controls}>{children}</VoiceContext.Provider>;
}

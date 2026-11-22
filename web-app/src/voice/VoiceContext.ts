import { createContext } from "react";
import type { Choice, DecisionResponse, GameOptions, SessionEnvelope } from "../models/api";

export type VoicePhase = "IDLE" | "LISTENING" | "DECIDING" | "PROPOSAL" | "CHOICES" | "CONFIRM_APP";

/** What the game page offers the voice flow while it is on screen. */
export interface VoiceGameTarget {
  sessionId: string;
  version: number;
  replace: (envelope: SessionEnvelope) => void;
  newGame: (options?: GameOptions) => Promise<void>;
}

export interface VoiceState {
  phase: VoicePhase;
  decision: DecisionResponse | null;
  /** The last thing the decider said, shown and optionally spoken. */
  message: string | null;
  proposedActionId: string | null;
  choices: Choice[];
  /** The microphone is capturing. */
  recording: boolean;
  /** Speech input can capture audio, not only typed commands. */
  canRecord: boolean;
}

export interface VoiceControls extends VoiceState {
  startListening: () => void;
  /** Stops capture and sends what was heard. */
  stopRecording: () => void;
  submit: (transcript: string) => void;
  confirm: () => void;
  cancel: () => void;
  choose: (number: number) => void;
  setGameTarget: (target: VoiceGameTarget | null) => void;
  /** Voice is offered only while its controls are on screen (a game); the keys listen only then. */
  setActive: (active: boolean) => void;
}

export const VoiceContext = createContext<VoiceControls | null>(null);

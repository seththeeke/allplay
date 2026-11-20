import type { TranscriptionResponse, TranscriptSource } from "../models/api";
import { startRecording, type Recording } from "./audioCapture";

export interface Heard {
  text: string;
  transcriptSource: TranscriptSource;
}

/** One microphone capture in progress. */
export interface SpeechCapture {
  /** Stops capture and returns the transcript. */
  stop(): Promise<Heard>;
  /** Stops capture and discards the audio. */
  cancel(): void;
}

/**
 * Speech input (action-decision.md section 16), chosen from the stage
 * config's `speechInput`. `start` is null when only typed commands are taken.
 */
export interface SpeechInput {
  readonly kind: "LOCAL_SERVER" | "TYPED";
  readonly start: (() => Promise<SpeechCapture>) | null;
}

export const typedSpeechInput: SpeechInput = { kind: "TYPED", start: null };

/** Captures 16 kHz audio in the browser and transcribes it on the local server (action-decision.md section 3.4). */
export function createLocalServerSpeechInput(
  transcribe: (wav: Uint8Array<ArrayBuffer>) => Promise<TranscriptionResponse>,
  record: () => Promise<Recording> = startRecording,
): SpeechInput {
  return {
    kind: "LOCAL_SERVER",
    start: async () => {
      const recording = await record();
      return {
        stop: async () => {
          const result = await transcribe(await recording.stop());
          return { text: result.text, transcriptSource: result.transcriptSource };
        },
        cancel: () => {
          recording.cancel();
        },
      };
    },
  };
}

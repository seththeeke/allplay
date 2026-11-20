import type { ProviderStatus } from "./speechToText";

/**
 * Text to speech on the local server (action-decision.md sections 13 and 16).
 * `rate` is the player's speech rate, 0.75 to 1.5. Audio is WAV.
 */
export interface TextToSpeech {
  readonly name: string;
  status(): Promise<ProviderStatus>;
  synthesize(text: string, rate: number): Promise<Uint8Array>;
}

/** Longest text one request may speak; decider replies are far shorter. */
export const MAX_SPEECH_CHARS = 600;

/** A 16 kHz mono 16-bit WAV of silence, `ms` long. */
export function silentWav(ms = 100): Uint8Array {
  const samples = Math.round((16000 * ms) / 1000);
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples * 2, true);
  return bytes;
}

/**
 * Keeps what it was asked to say and plays silence, for tests and for
 * automation that cannot listen (local-development.md section 6).
 */
export function createRecordingTts(): TextToSpeech & { spoken: string[] } {
  const spoken: string[] = [];
  return {
    name: "recording",
    spoken,
    status: () =>
      Promise.resolve({
        available: true,
        detail: "Records the text it would speak; plays silence.",
      }),
    synthesize: (text) => {
      spoken.push(text);
      return Promise.resolve(silentWav());
    },
  };
}

/** A TextToSpeech that is not set up: status says why, and synthesis fails as unavailable. */
export function createUnavailableTts(name: string, detail: string): TextToSpeech {
  return {
    name,
    status: () => Promise.resolve({ available: false, detail }),
    synthesize: () => Promise.reject(new SpeechOutputUnavailableError(detail)),
  };
}

export class SpeechOutputUnavailableError extends Error {
  override readonly name = "SpeechOutputUnavailableError";
}

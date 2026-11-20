import type { TranscriptSource } from "../../models/api";

export interface ProviderStatus {
  available: boolean;
  detail: string;
}

export interface Transcription {
  text: string;
}

/**
 * Speech to text on the local server (action-decision.md sections 3.4 and 16).
 * Audio is 16 kHz mono 16-bit PCM WAV, held in memory for one request.
 */
export interface SpeechToText {
  readonly name: string;
  readonly transcriptSource: TranscriptSource;
  status(): Promise<ProviderStatus>;
  transcribe(wav: Uint8Array): Promise<Transcription>;
}

export class SpeechUnavailableError extends Error {
  override readonly name = "SpeechUnavailableError";
}

/** True for a RIFF/WAVE header, the only audio the local speech route accepts. */
export function isWav(bytes: Uint8Array): boolean {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  return bytes.length > 44 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE";
}

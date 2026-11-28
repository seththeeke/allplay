import type { TranscriptionResponse } from "../models/api";
import {
  startContinuousCapture,
  type CaptureHandlers,
  type ContinuousCapture,
} from "./continuousCapture";
import type { Heard } from "./speechInput";
import { encodeWav } from "./wav";
import { SAMPLE_RATE } from "./audioCapture";

export interface ListenHandlers {
  onSpeechStart: () => void;
  /** The player finished speaking and this is what they said. */
  onHeard: (heard: Heard) => void;
  /** The detected sound held no utterance. */
  onNothing: () => void;
  onError: (error: unknown) => void;
}

export type ContinuousListener = ContinuousCapture;
export type StartListening = (
  handlers: ListenHandlers,
  silenceMs: number,
) => Promise<ContinuousListener>;
export type StartCapture = (
  handlers: CaptureHandlers,
  silenceMs: number,
) => Promise<ContinuousCapture>;

/** Each utterance goes to the local server as WAV (conversational-ai.md section 3.2). */
export function localServerListener(
  transcribe: (wav: Uint8Array<ArrayBuffer>) => Promise<TranscriptionResponse>,
  capture: StartCapture = startContinuousCapture,
): StartListening {
  return (handlers, silenceMs) =>
    capture(
      {
        onSpeechStart: handlers.onSpeechStart,
        onFrame: () => undefined,
        onDiscard: handlers.onNothing,
        onSpeechEnd: (audio) => {
          void transcribe(encodeWav([...audio], SAMPLE_RATE))
            .then((result) => {
              if (result.text.trim() === "") handlers.onNothing();
              else
                handlers.onHeard({
                  text: result.text,
                  transcriptSource: result.transcriptSource,
                });
            })
            .catch(handlers.onError);
        },
      },
      silenceMs,
    );
}

/** One open Transcribe stream: audio goes in, partial and final text comes back. */
export interface TranscribeStream {
  send(pcm: Uint8Array): void;
  close(): void;
}

export type OpenTranscribeStream = (
  onText: (text: string, isFinal: boolean) => void,
  onError: (error: unknown) => void,
  onClosed: () => void,
) => TranscribeStream;

/** How long a stream stays open with no speech (conversational-ai.md section 3.2). */
export const STREAM_IDLE_MS = 15_000;
/** How long to wait for Transcribe's final text after the player stops. */
export const FINAL_TEXT_WAIT_MS = 1_500;

const toPcm = (frame: Float32Array): Uint8Array => {
  const bytes = new Uint8Array(frame.length * 2);
  const view = new DataView(bytes.buffer);
  frame.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  });
  return bytes;
};

/**
 * Speech-gated Transcribe (conversational-ai.md section 3.2): detected speech
 * opens a stream with the buffered audio first. It stays open through pauses,
 * since Transcribe bills 15 seconds per stream anyway, then closes when quiet.
 */
export function transcribeListener(
  open: OpenTranscribeStream,
  capture: StartCapture = startContinuousCapture,
  /** End of speech to the final text, for the admin latency charts (productionalization.md section 7). */
  onLatency: (ms: number) => void = () => undefined,
  clock: () => number = () => performance.now(),
): StartListening {
  return async (handlers, silenceMs) => {
    let stream: TranscribeStream | null = null;
    let finals: string[] = [];
    let partial = "";
    let awaitingFinal = false;
    let idle: ReturnType<typeof setTimeout> | null = null;
    let wait: ReturnType<typeof setTimeout> | null = null;
    let speechEndedAt: number | null = null;

    const clear = (timer: ReturnType<typeof setTimeout> | null): null => {
      if (timer !== null) clearTimeout(timer);
      return null;
    };
    const flush = (): void => {
      wait = clear(wait);
      awaitingFinal = false;
      if (speechEndedAt !== null && finals.length > 0) onLatency(clock() - speechEndedAt);
      speechEndedAt = null;
      const text = [...finals, partial].join(" ").trim();
      finals = [];
      partial = "";
      if (text === "") handlers.onNothing();
      else handlers.onHeard({ text, transcriptSource: "TRANSCRIBE" });
    };
    const closeStream = (): void => {
      idle = clear(idle);
      stream?.close();
      stream = null;
    };
    const armIdle = (): void => {
      idle = clear(idle);
      idle = setTimeout(closeStream, STREAM_IDLE_MS);
    };
    const onText = (text: string, isFinal: boolean): void => {
      if (isFinal) {
        finals.push(text);
        partial = "";
        if (awaitingFinal) flush();
      } else {
        partial = text;
      }
    };
    const onStreamError = (error: unknown): void => {
      stream = null;
      idle = clear(idle);
      if (awaitingFinal) flush();
      handlers.onError(error);
    };
    const onClosed = (): void => {
      stream = null;
      if (awaitingFinal) flush();
    };

    const listener = await capture(
      {
        onSpeechStart: (preRoll) => {
          handlers.onSpeechStart();
          idle = clear(idle);
          if (awaitingFinal) flush();
          finals = [];
          partial = "";
          if (stream === null) {
            stream = open(onText, onStreamError, onClosed);
            for (const frame of preRoll) stream.send(toPcm(frame));
          }
        },
        onFrame: (frame) => {
          stream?.send(toPcm(frame));
        },
        onDiscard: () => {
          armIdle();
          handlers.onNothing();
        },
        onSpeechEnd: () => {
          armIdle();
          speechEndedAt = clock();
          if (finals.length > 0 && partial === "") {
            flush();
            return;
          }
          awaitingFinal = true;
          wait = setTimeout(flush, FINAL_TEXT_WAIT_MS);
        },
      },
      silenceMs,
    );
    return {
      setSpeaking: (speaking) => {
        listener.setSpeaking(speaking);
      },
      setSilenceMs: (next) => {
        listener.setSilenceMs(next);
      },
      stop: () => {
        wait = clear(wait);
        awaitingFinal = false;
        closeStream();
        listener.stop();
      },
    };
  };
}

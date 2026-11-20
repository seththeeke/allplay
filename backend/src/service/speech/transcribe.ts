import {
  StartStreamTranscriptionCommand,
  TranscribeStreamingClient,
  type AudioStream,
  type StartStreamTranscriptionCommandOutput,
} from "@aws-sdk/client-transcribe-streaming";
import { SpeechUnavailableError, type SpeechToText } from "./speechToText";
import { pcmFromWav } from "./wav";

/** The part of the Transcribe streaming client this implementation uses, so tests can stand in for it. */
export interface TranscribeApi {
  send(
    command: StartStreamTranscriptionCommand,
    options?: { abortSignal?: AbortSignal },
  ): Promise<Pick<StartStreamTranscriptionCommandOutput, "TranscriptResultStream">>;
  /** Resolves the caller's AWS credentials, or rejects when there are none. */
  credentials(): Promise<unknown>;
}

export interface TranscribeOptions {
  region: string;
  /** A Transcribe custom vocabulary; unset until AD-6 creates the stage's. */
  vocabularyName?: string;
  timeoutMs?: number;
}

/** 100 ms of 16 kHz 16-bit mono audio per event. */
export const CHUNK_BYTES = 3200;

export function transcribeStreaming(region: string): TranscribeApi {
  const client = new TranscribeStreamingClient({ region });
  return {
    send: (command, options) => client.send(command, options),
    credentials: () => client.config.credentials(),
  };
}

/** The clip as Transcribe audio events, 100 ms each. */
export function audioEvents(samples: Uint8Array): AsyncIterable<AudioStream> {
  return {
    [Symbol.asyncIterator]: () => {
      let offset = 0;
      return {
        next: (): Promise<IteratorResult<AudioStream>> => {
          if (offset >= samples.length) return Promise.resolve({ done: true, value: undefined });
          const chunk = samples.slice(offset, offset + CHUNK_BYTES);
          offset += CHUNK_BYTES;
          return Promise.resolve({ done: false, value: { AudioEvent: { AudioChunk: chunk } } });
        },
      };
    },
  };
}

/**
 * Amazon Transcribe streaming on the local server
 * (transcribe-polly-bedrock.md section 5): the uploaded clip's PCM is
 * streamed in 100 ms events, and the final result segments make the transcript.
 */
export function createTranscribe(
  options: TranscribeOptions,
  api: TranscribeApi = transcribeStreaming(options.region),
): SpeechToText {
  return {
    name: "transcribe",
    transcriptSource: "TRANSCRIBE",
    status: async () => {
      try {
        await api.credentials();
        return { available: true, detail: "Amazon Transcribe streaming, en-US." };
      } catch {
        return {
          available: false,
          detail: "No AWS credentials. Start the server with the allplays AWS profile.",
        };
      }
    },
    transcribe: async (wav) => {
      const pcm = pcmFromWav(wav);
      if (pcm?.sampleRate !== 16000)
        throw new SpeechUnavailableError("Transcribe needs 16 kHz mono 16-bit WAV audio.");
      const abort = new AbortController();
      const timer = setTimeout(() => {
        abort.abort();
      }, options.timeoutMs ?? 10_000);
      try {
        const response = await api.send(
          new StartStreamTranscriptionCommand({
            LanguageCode: "en-US",
            MediaEncoding: "pcm",
            MediaSampleRateHertz: 16000,
            EnablePartialResultsStabilization: true,
            PartialResultsStability: "high",
            ...(options.vocabularyName === undefined
              ? {}
              : { VocabularyName: options.vocabularyName }),
            AudioStream: audioEvents(pcm.samples),
          }),
          { abortSignal: abort.signal },
        );
        const segments: string[] = [];
        for await (const event of response.TranscriptResultStream ?? []) {
          for (const result of event.TranscriptEvent?.Transcript?.Results ?? []) {
            const text = result.Alternatives?.[0]?.Transcript;
            if (result.IsPartial !== true && text !== undefined) segments.push(text);
          }
        }
        return { text: segments.join(" ").trim() };
      } catch (error) {
        throw new SpeechUnavailableError(
          abort.signal.aborted
            ? "Transcribe took too long to answer."
            : `Transcribe failed: ${String(error)}`,
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

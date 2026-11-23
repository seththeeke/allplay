import type { Heard, SpeechInput } from "./speechInput";
import { startRecording, type Recording } from "./audioCapture";
import type { Playback, PlayAudio, SpeechOutput } from "./speechOutput";
import { playBlob } from "./speechOutput";

/** Temporary AWS credentials from the Identity Pool, guest or signed in (action-decision.md section 3.1). */
export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export type CredentialSource = () => Promise<AwsCredentials>;

/** 100 ms of 16 kHz 16-bit mono audio per Transcribe event. */
const CHUNK_BYTES = 3200;
/** `encodeWav` writes a 44 byte header before the samples. */
const WAV_HEADER_BYTES = 44;

/** The part of the Transcribe streaming client the browser uses, loaded on first use. */
export type TranscribeSend = (pcm: Uint8Array, vocabularyName?: string) => Promise<string>;

/** Streams a clip to Amazon Transcribe in 100 ms events and joins the final segments. */
export function transcribeSender(region: string, credentials: CredentialSource): TranscribeSend {
  return async (pcm, vocabularyName) => {
    const { TranscribeStreamingClient, StartStreamTranscriptionCommand } =
      await import("@aws-sdk/client-transcribe-streaming");
    const client = new TranscribeStreamingClient({ region, credentials });
    const audio = (): AsyncIterable<{ AudioEvent: { AudioChunk: Uint8Array } }> => ({
      [Symbol.asyncIterator]: () => {
        let offset = 0;
        return {
          next: () => {
            if (offset >= pcm.length) return Promise.resolve({ done: true, value: undefined });
            const chunk = pcm.slice(offset, offset + CHUNK_BYTES);
            offset += CHUNK_BYTES;
            return Promise.resolve({ done: false, value: { AudioEvent: { AudioChunk: chunk } } });
          },
        };
      },
    });
    const response = await client.send(
      new StartStreamTranscriptionCommand({
        LanguageCode: "en-US",
        MediaEncoding: "pcm",
        MediaSampleRateHertz: 16000,
        EnablePartialResultsStabilization: true,
        PartialResultsStability: "high",
        ...(vocabularyName === undefined ? {} : { VocabularyName: vocabularyName }),
        AudioStream: audio(),
      }),
    );
    const segments: string[] = [];
    for await (const event of response.TranscriptResultStream ?? []) {
      for (const result of event.TranscriptEvent?.Transcript?.Results ?? []) {
        const text = result.Alternatives?.[0]?.Transcript;
        if (result.IsPartial !== true && text !== undefined) segments.push(text);
      }
    }
    return segments.join(" ").trim();
  };
}

/**
 * Speech input through Amazon Transcribe streaming with the player's
 * Identity Pool credentials (action-decision.md section 3.1). Audio is
 * captured at 16 kHz while the player speaks and streamed when listening
 * ends; it goes to Transcribe only and is never stored.
 */
export function createTranscribeSpeechInput(
  send: TranscribeSend,
  vocabularyName?: string,
  record: () => Promise<Recording> = startRecording,
): SpeechInput {
  return {
    kind: "TRANSCRIBE",
    start: async () => {
      const recording = await record();
      return {
        stop: async (): Promise<Heard> => {
          const wav = await recording.stop();
          const text = await send(wav.slice(WAV_HEADER_BYTES), vocabularyName);
          return { text, transcriptSource: "TRANSCRIBE" };
        },
        cancel: () => {
          recording.cancel();
        },
      };
    },
  };
}

/** The part of Polly the browser uses: synthesized MP3 audio for SSML text. */
export type PollySynthesize = (ssml: string, voiceId: string) => Promise<Blob>;

export function pollySynthesizer(region: string, credentials: CredentialSource): PollySynthesize {
  return async (ssml, voiceId) => {
    const { PollyClient, SynthesizeSpeechCommand } = await import("@aws-sdk/client-polly");
    const client = new PollyClient({ region, credentials });
    const out = await client.send(
      new SynthesizeSpeechCommand({
        Engine: "neural",
        OutputFormat: "mp3",
        TextType: "ssml",
        Text: ssml,
        VoiceId: voiceId as never,
      }),
    );
    const bytes = await out.AudioStream?.transformToByteArray();
    if (bytes === undefined) throw new Error("Polly returned no audio.");
    return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "audio/mpeg" });
  };
}

const escapeXml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Speaks through Amazon Polly (action-decision.md section 13): the player's
 * voice, SSML prosody from the speech rate, audio cached by text for the
 * session, a new reply stopping the one playing, and the browser's voice
 * when Polly cannot answer.
 */
export function createPollySpeechOutput(
  synthesize: PollySynthesize,
  fallback: SpeechOutput,
  play: PlayAudio = playBlob,
): SpeechOutput {
  const cache = new Map<string, Promise<Blob>>();
  let playing: Playback | null = null;
  return {
    speak: (text, rate, voiceId = "Joanna") => {
      playing?.stop();
      playing = null;
      const voice = voiceId;
      const key = `${voice}|${String(rate)}|${text}`;
      const ssml = `<speak><prosody rate="${String(Math.round(rate * 100))}%">${escapeXml(text)}</prosody></speak>`;
      const audio = cache.get(key) ?? synthesize(ssml, voice);
      cache.set(key, audio);
      void audio
        .then((blob) => {
          playing = play(blob);
        })
        .catch(() => {
          cache.delete(key);
          fallback.speak(text, rate);
        });
    },
  };
}

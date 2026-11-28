import {
  PollyClient,
  SynthesizeSpeechCommand,
  type SynthesizeSpeechCommandOutput,
  type VoiceId,
} from "@aws-sdk/client-polly";
import { SpeechOutputUnavailableError, type TextToSpeech } from "./textToSpeech";
import { wavFromPcm } from "./wav";

/** The part of the Polly client this implementation uses, so tests can stand in for it. */
export interface PollyApi {
  send(
    command: SynthesizeSpeechCommand,
    options?: { abortSignal?: AbortSignal },
  ): Promise<Pick<SynthesizeSpeechCommandOutput, "AudioStream">>;
  /** Resolves the caller's AWS credentials, or rejects when there are none. */
  credentials(): Promise<unknown>;
}

export interface PollyOptions {
  region: string;
  /** A Polly generative voice, the `voiceId` preference's default `Ruth` (data-model.md section 5). */
  voiceId: string;
  timeoutMs?: number;
}

export function pollyClient(region: string): PollyApi {
  const client = new PollyClient({ region });
  return {
    send: (command, options) => client.send(command, options),
    credentials: () => client.config.credentials(),
  };
}

const escapeXml = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

/** SSML that speaks the text at the player's rate (action-decision.md section 13). */
export function ssmlFor(text: string, rate: number): string {
  return `<speak><prosody rate="${String(Math.round(rate * 100))}%">${escapeXml(text)}</prosody></speak>`;
}

/**
 * Amazon Polly on the local server (transcribe-polly-bedrock.md section 6):
 * generative voice, 16 kHz PCM wrapped as WAV, so the synthesize route and the
 * web player are unchanged.
 */
export function createPolly(
  options: PollyOptions,
  api: PollyApi = pollyClient(options.region),
): TextToSpeech {
  return {
    name: "polly",
    status: async () => {
      try {
        await api.credentials();
        return { available: true, detail: `Amazon Polly generative, voice ${options.voiceId}.` };
      } catch {
        return {
          available: false,
          detail: "No AWS credentials. Start the server with the allplays AWS profile.",
        };
      }
    },
    synthesize: async (text, rate) => {
      const abort = new AbortController();
      const timer = setTimeout(() => {
        abort.abort();
      }, options.timeoutMs ?? 5_000);
      try {
        const response = await api.send(
          new SynthesizeSpeechCommand({
            Engine: "generative",
            OutputFormat: "pcm",
            SampleRate: "16000",
            TextType: "ssml",
            Text: ssmlFor(text, rate),
            VoiceId: options.voiceId as VoiceId,
          }),
          { abortSignal: abort.signal },
        );
        const pcm = await response.AudioStream?.transformToByteArray();
        if (pcm === undefined) throw new Error("Polly returned no audio.");
        return wavFromPcm(pcm, 16000);
      } catch (error) {
        throw new SpeechOutputUnavailableError(
          abort.signal.aborted
            ? "Polly took too long to answer."
            : `Polly failed: ${String(error)}`,
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

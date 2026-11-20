import { SynthesizeSpeechCommand } from "@aws-sdk/client-polly";
import { describe, expect, it, vi } from "vitest";
import {
  createPolly,
  pollyClient,
  ssmlFor,
  type PollyApi,
} from "../../../src/service/speech/polly";
import { SpeechOutputUnavailableError } from "../../../src/service/speech/textToSpeech";
import { pcmFromWav } from "../../../src/service/speech/wav";

function api(audio: Uint8Array | null | Error, credentials = true) {
  type Output = Awaited<ReturnType<PollyApi["send"]>>;
  const output: Output =
    audio === null || audio instanceof Error
      ? {}
      : ({
          AudioStream: { transformToByteArray: () => Promise.resolve(audio) },
        } as unknown as Output);
  const send = vi.fn<PollyApi["send"]>(() =>
    audio instanceof Error ? Promise.reject(audio) : Promise.resolve(output),
  );
  const stub: PollyApi = {
    send,
    credentials: () => (credentials ? Promise.resolve({}) : Promise.reject(new Error("none"))),
  };
  return { stub, send };
}

describe("Polly", () => {
  it("speaks escaped SSML at the player's rate with the neural voice, as WAV", async () => {
    const pcm = new Uint8Array([1, 0, 2, 0]);
    const { stub, send } = api(pcm);
    const polly = createPolly({ region: "us-east-1", voiceId: "Joanna" }, stub);
    const wav = await polly.synthesize("Seven & <eight>", 1.25);
    expect(pcmFromWav(wav)).toEqual({ samples: pcm, sampleRate: 16000 });
    const command = send.mock.calls[0]?.[0] as SynthesizeSpeechCommand;
    expect(command.input).toEqual({
      Engine: "neural",
      OutputFormat: "pcm",
      SampleRate: "16000",
      TextType: "ssml",
      Text: '<speak><prosody rate="125%">Seven &amp; &lt;eight&gt;</prosody></speak>',
      VoiceId: "Joanna",
    });
    expect(ssmlFor(`"it's"`, 0.75)).toBe(
      '<speak><prosody rate="75%">&quot;it&apos;s&quot;</prosody></speak>',
    );
  });

  it("reports failures, empty audio, timeouts and missing credentials", async () => {
    await expect(
      createPolly({ region: "r", voiceId: "Joanna" }, api(new Error("Throttling")).stub).synthesize(
        "x",
        1,
      ),
    ).rejects.toThrow("Polly failed: Error: Throttling");
    await expect(
      createPolly({ region: "r", voiceId: "Joanna" }, api(null).stub).synthesize("x", 1),
    ).rejects.toBeInstanceOf(SpeechOutputUnavailableError);
    const slow: PollyApi = {
      send: (_command, options) =>
        new Promise((_resolve, reject) => {
          options?.abortSignal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
      credentials: () => Promise.resolve({}),
    };
    await expect(
      createPolly({ region: "r", voiceId: "Joanna", timeoutMs: 10 }, slow).synthesize("x", 1),
    ).rejects.toThrow("took too long");
    expect(await createPolly({ region: "r", voiceId: "Joanna" }, api(null).stub).status()).toEqual({
      available: true,
      detail: "Amazon Polly neural, voice Joanna.",
    });
    expect(
      (await createPolly({ region: "r", voiceId: "Joanna" }, api(null, false).stub).status())
        .available,
    ).toBe(false);
  });

  it("builds an SDK client with the default credential chain", async () => {
    const client = pollyClient("us-east-1");
    await expect(
      client.credentials().then(
        () => true,
        () => true,
      ),
    ).resolves.toBe(true);
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      client.send(
        new SynthesizeSpeechCommand({ OutputFormat: "pcm", Text: "x", VoiceId: "Joanna" }),
        {
          abortSignal: aborted.signal,
        },
      ),
    ).rejects.toThrow();
  });
});

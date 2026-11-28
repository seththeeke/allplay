import { describe, expect, it, vi } from "vitest";

const transcribe = vi.hoisted(() => ({
  sent: [] as Record<string, unknown>[],
  results: [] as unknown[],
}));
vi.mock("@aws-sdk/client-transcribe-streaming", () => ({
  TranscribeStreamingClient: class {
    send(command: { input: Record<string, unknown> }) {
      transcribe.sent.push(command.input);
      return Promise.resolve({
        TranscriptResultStream: {
          [Symbol.asyncIterator]: () => {
            const results = [...transcribe.results];
            return {
              next: () =>
                Promise.resolve(
                  results.length === 0
                    ? { done: true, value: undefined }
                    : { done: false, value: results.shift() },
                ),
            };
          },
        },
      });
    }
  },
  StartStreamTranscriptionCommand: class {
    constructor(readonly input: Record<string, unknown>) {}
  },
}));
const polly = vi.hoisted(() => ({ sent: [] as Record<string, unknown>[], audio: true }));
vi.mock("@aws-sdk/client-polly", () => ({
  PollyClient: class {
    send(command: { input: Record<string, unknown> }) {
      polly.sent.push(command.input);
      return Promise.resolve({
        AudioStream: polly.audio
          ? { transformToByteArray: () => Promise.resolve(new Uint8Array([1, 2])) }
          : undefined,
      });
    }
  },
  SynthesizeSpeechCommand: class {
    constructor(readonly input: Record<string, unknown>) {}
  },
}));

import {
  createPollySpeechOutput,
  createTranscribeSpeechInput,
  pollySynthesizer,
  transcribeSender,
  transcribeStreamOpener,
} from "../../src/voice/awsVoice";

const credentials = () => Promise.resolve({ accessKeyId: "a", secretAccessKey: "s" });
const partial = (text: string) => ({ IsPartial: true, Alternatives: [{ Transcript: text }] });
const final = (text: string) => ({ IsPartial: false, Alternatives: [{ Transcript: text }] });

describe("Transcribe speech input", () => {
  it("records, then sends the clip's samples without the WAV header", async () => {
    const send = vi.fn(() => Promise.resolve("deal"));
    const wav = new Uint8Array(44 + 6).fill(7);
    const cancel = vi.fn();
    const input = createTranscribeSpeechInput(send, "allplay-vocabulary-test", () =>
      Promise.resolve({ stop: () => Promise.resolve(wav), cancel }),
    );
    expect(input.kind).toBe("TRANSCRIBE");
    const capture = await (input.start as NonNullable<typeof input.start>)();
    expect(await capture.stop()).toEqual({ text: "deal", transcriptSource: "TRANSCRIBE" });
    expect(send).toHaveBeenCalledWith(wav.slice(44), "allplay-vocabulary-test");
    capture.cancel();
    expect(cancel).toHaveBeenCalled();
  });

  it("streams 100 ms events and joins the final segments only", async () => {
    transcribe.results = [
      {
        TranscriptEvent: {
          Transcript: { Results: [{ IsPartial: true, Alternatives: [{ Transcript: "dea" }] }] },
        },
      },
      {
        TranscriptEvent: {
          Transcript: { Results: [{ IsPartial: false, Alternatives: [{ Transcript: "Deal" }] }] },
        },
      },
      {
        TranscriptEvent: {
          Transcript: { Results: [{ IsPartial: false, Alternatives: [{ Transcript: "a row." }] }] },
        },
      },
      { TranscriptEvent: { Transcript: { Results: [{ IsPartial: false, Alternatives: [] }] } } },
      {},
    ];
    const send = transcribeSender("us-east-1", credentials);
    expect(await send(new Uint8Array(6400), "vocab")).toBe("Deal a row.");
    const input = transcribe.sent.at(-1) ?? {};
    expect(input).toMatchObject({
      LanguageCode: "en-US",
      MediaEncoding: "pcm",
      MediaSampleRateHertz: 16000,
      VocabularyName: "vocab",
    });
    const chunks: number[] = [];
    for await (const event of input["AudioStream"] as AsyncIterable<{
      AudioEvent: { AudioChunk: Uint8Array };
    }>)
      chunks.push(event.AudioEvent.AudioChunk.length);
    expect(chunks).toEqual([3200, 3200]);
    transcribe.results = [];
    expect(await send(new Uint8Array(10))).toBe("");
    expect(transcribe.sent.at(-1)).not.toHaveProperty("VocabularyName");
  });
});

describe("Polly speech output", () => {
  it("speaks SSML at the player's rate and voice, caching audio and stopping the last clip", async () => {
    const synthesize = vi.fn(() => Promise.resolve(new Blob(["mp3"])));
    const stop = vi.fn();
    const play = vi.fn(() => ({ stop }));
    const fallback = { speak: vi.fn() };
    const output = createPollySpeechOutput(synthesize, fallback, play);
    output.speak("Seven & eight", 1.25, "Matthew");
    await vi.waitFor(() => {
      expect(play).toHaveBeenCalledTimes(1);
    });
    expect(synthesize).toHaveBeenCalledWith(
      '<speak><prosody rate="125%">Seven &amp; eight</prosody></speak>',
      "Matthew",
    );
    output.speak("Seven & eight", 1.25, "Matthew");
    await vi.waitFor(() => {
      expect(play).toHaveBeenCalledTimes(2);
    });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(synthesize).toHaveBeenCalledTimes(1);
    output.speak("<hi>", 1);
    await vi.waitFor(() => {
      expect(play).toHaveBeenCalledTimes(3);
    });
    expect(synthesize).toHaveBeenLastCalledWith(
      '<speak><prosody rate="100%">&lt;hi&gt;</prosody></speak>',
      "Ruth",
    );
  });

  it("falls back to the browser voice when Polly cannot answer", async () => {
    const fallback = { speak: vi.fn() };
    const output = createPollySpeechOutput(
      () => Promise.reject(new Error("no")),
      fallback,
      vi.fn(),
    );
    output.speak("Hello", 1, "Joanna");
    await vi.waitFor(() => {
      expect(fallback.speak).toHaveBeenCalledWith("Hello", 1);
    });
  });

  it("asks Polly for generative MP3 audio", async () => {
    const synthesize = pollySynthesizer("us-east-1", credentials);
    const blob = await synthesize("<speak>Hi</speak>", "Joanna");
    expect(blob.type).toBe("audio/mpeg");
    expect(polly.sent.at(-1)).toEqual({
      Engine: "generative",
      OutputFormat: "mp3",
      TextType: "ssml",
      Text: "<speak>Hi</speak>",
      VoiceId: "Joanna",
    });
    polly.audio = false;
    await expect(synthesize("<speak>Hi</speak>", "Joanna")).rejects.toThrow("no audio");
  });
});

describe("live Transcribe stream", () => {
  it("streams queued audio and reports partial and final text until closed", async () => {
    transcribe.sent.length = 0;
    transcribe.results = [
      { TranscriptEvent: { Transcript: { Results: [partial("move")] } } },
      { TranscriptEvent: { Transcript: { Results: [final("move eight"), { Alternatives: [] }] } } },
      {},
    ];
    const onText = vi.fn();
    const onError = vi.fn();
    const onClosed = vi.fn();
    const stream = transcribeStreamOpener("us-east-1", credentials, "vocab")(
      onText,
      onError,
      onClosed,
    );
    stream.send(new Uint8Array([1]));
    await vi.waitFor(() => {
      expect(onClosed).toHaveBeenCalled();
    });
    expect(onText.mock.calls).toEqual([
      ["move", false],
      ["move eight", true],
    ]);
    const input = transcribe.sent[0] as {
      VocabularyName: string;
      AudioStream: AsyncIterable<{ AudioEvent: { AudioChunk: Uint8Array } }>;
    };
    expect(input.VocabularyName).toBe("vocab");
    const chunks: number[] = [];
    const reading = (async () => {
      for await (const event of input.AudioStream) chunks.push(...event.AudioEvent.AudioChunk);
    })();
    await vi.waitFor(() => {
      expect(chunks).toEqual([1]);
    });
    stream.send(new Uint8Array([2]));
    await vi.waitFor(() => {
      expect(chunks).toEqual([1, 2]);
    });
    stream.close();
    await reading;
    stream.send(new Uint8Array([3]));
    expect(chunks).toEqual([1, 2]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("leaves the vocabulary out when none is set and reports a failure", async () => {
    transcribe.sent.length = 0;
    transcribe.results = [];
    const onClosed = vi.fn();
    transcribeStreamOpener("us-east-1", credentials)(vi.fn(), vi.fn(), onClosed).close();
    await vi.waitFor(() => {
      expect(onClosed).toHaveBeenCalled();
    });
    expect(transcribe.sent[0]).not.toHaveProperty("VocabularyName");
    const onError = vi.fn();
    transcribeStreamOpener("us-east-1", () => credentials(), undefined);
    transcribe.results = [
      {
        get TranscriptEvent() {
          throw new Error("broken");
        },
      },
    ];
    transcribeStreamOpener("us-east-1", credentials)(vi.fn(), onError, vi.fn());
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });
  });
});

describe("interruptible Polly speech", () => {
  it("reports the end once, and drops audio that arrives after a stop", async () => {
    let deliver: (blob: Blob) => void = () => undefined;
    const synthesize = vi.fn(
      () =>
        new Promise<Blob>((resolve) => {
          deliver = resolve;
        }),
    );
    const play = vi.fn(() => ({ stop: vi.fn() }));
    const output = createPollySpeechOutput(synthesize, { speak: vi.fn() }, play);
    const onEnd = vi.fn();
    output.speak("Hello", 1, "Joanna", onEnd);
    output.stop?.();
    expect(onEnd).toHaveBeenCalledTimes(1);
    deliver(new Blob(["a"]));
    await Promise.resolve();
    await Promise.resolve();
    expect(play).not.toHaveBeenCalled();
  });

  it("gives the fallback voice the end callback, and not after a stop", async () => {
    const fallback = { speak: vi.fn() };
    const output = createPollySpeechOutput(
      () => Promise.reject(new Error("down")),
      fallback,
      vi.fn(),
    );
    output.speak("Hello", 1, "Joanna", vi.fn());
    await vi.waitFor(() => {
      expect(fallback.speak).toHaveBeenCalledWith("Hello", 1, "Joanna", expect.any(Function));
    });
    fallback.speak.mockClear();
    output.speak("Again", 1, "Joanna", vi.fn());
    output.stop?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(fallback.speak).not.toHaveBeenCalled();
  });
});

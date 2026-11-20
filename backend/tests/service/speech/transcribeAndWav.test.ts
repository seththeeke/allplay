import {
  StartStreamTranscriptionCommand,
  type AudioStream,
} from "@aws-sdk/client-transcribe-streaming";
import { describe, expect, it, vi } from "vitest";
import { SpeechUnavailableError } from "../../../src/service/speech/speechToText";
import {
  audioEvents,
  CHUNK_BYTES,
  createTranscribe,
  transcribeStreaming,
  type TranscribeApi,
} from "../../../src/service/speech/transcribe";
import { pcmFromWav, wavFromPcm } from "../../../src/service/speech/wav";

describe("WAV helpers", () => {
  it("round-trips PCM through a WAV header", () => {
    const pcm = new Uint8Array([1, 2, 3, 4]);
    const wav = wavFromPcm(pcm, 16000);
    expect(wav.length).toBe(48);
    expect(pcmFromWav(wav)).toEqual({ samples: pcm, sampleRate: 16000 });
  });

  it("skips other chunks and refuses non-PCM, stereo, 8-bit and truncated files", () => {
    const wav = wavFromPcm(new Uint8Array([9, 9]), 22050);
    const withList = new Uint8Array(wav.length + 10);
    withList.set(wav.slice(0, 36));
    withList.set([0x4c, 0x49, 0x53, 0x54, 1, 0, 0, 0, 7, 0], 36);
    withList.set(wav.slice(36), 46);
    expect(pcmFromWav(withList)).toEqual({ samples: new Uint8Array([9, 9]), sampleRate: 22050 });
    const patched = (offset: number, value: number) => {
      const copy = wav.slice();
      new DataView(copy.buffer).setUint16(offset, value, true);
      return copy;
    };
    expect(pcmFromWav(patched(20, 3))).toBeNull();
    expect(pcmFromWav(patched(22, 2))).toBeNull();
    expect(pcmFromWav(patched(34, 8))).toBeNull();
    expect(pcmFromWav(wav.slice(0, 30))).toBeNull();
    expect(pcmFromWav(new TextEncoder().encode("not a wav file"))).toBeNull();
    const dataFirst = wav.slice();
    dataFirst.set(new TextEncoder().encode("junk"), 12);
    expect(pcmFromWav(dataFirst)).toBeNull();
  });
});

/** The items as an async iterable, as the SDK's event streams are. */
function asyncOf<T>(items: readonly T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]: () => {
      let index = 0;
      return {
        next: (): Promise<IteratorResult<T>> =>
          Promise.resolve(
            index < items.length
              ? { done: false, value: items[index++] as T }
              : { done: true, value: undefined },
          ),
      };
    },
  };
}

function api(events: unknown[] | Error, credentials = true) {
  const chunks: Uint8Array[] = [];
  const send = vi.fn<TranscribeApi["send"]>(async (command) => {
    for await (const event of command.input.AudioStream as AsyncIterable<AudioStream>) {
      if (event.AudioEvent?.AudioChunk !== undefined) chunks.push(event.AudioEvent.AudioChunk);
    }
    if (events instanceof Error) throw events;
    return { TranscriptResultStream: asyncOf(events) as never };
  });
  const stub: TranscribeApi = {
    send,
    credentials: () => (credentials ? Promise.resolve({}) : Promise.reject(new Error("none"))),
  };
  return { stub, send, chunks };
}

const result = (text: string, partial: boolean) => ({
  TranscriptEvent: {
    Transcript: { Results: [{ IsPartial: partial, Alternatives: [{ Transcript: text }] }] },
  },
});

describe("Transcribe", () => {
  it("streams the clip in 100 ms events and joins the final segments", async () => {
    const t = api([
      result("move", true),
      result("Move 3", false),
      { TranscriptEvent: {} },
      result(" to 7.", false),
      {},
    ]);
    const transcribe = createTranscribe(
      { region: "us-east-1", vocabularyName: "allplay-vocabulary-local" },
      t.stub,
    );
    expect(transcribe.transcriptSource).toBe("TRANSCRIBE");
    const samples = new Uint8Array(CHUNK_BYTES * 2 + 100);
    expect(await transcribe.transcribe(wavFromPcm(samples, 16000))).toEqual({
      text: "Move 3  to 7.",
    });
    expect(t.chunks.map((c) => c.length)).toEqual([CHUNK_BYTES, CHUNK_BYTES, 100]);
    const command = t.send.mock.calls[0]?.[0] as StartStreamTranscriptionCommand;
    expect(command.input).toMatchObject({
      LanguageCode: "en-US",
      MediaEncoding: "pcm",
      MediaSampleRateHertz: 16000,
      EnablePartialResultsStabilization: true,
      PartialResultsStability: "high",
      VocabularyName: "allplay-vocabulary-local",
    });
    const plain = api([]);
    expect(
      await createTranscribe({ region: "r" }, plain.stub).transcribe(
        wavFromPcm(new Uint8Array(2), 16000),
      ),
    ).toEqual({
      text: "",
    });
    expect(
      (plain.send.mock.calls[0]?.[0] as StartStreamTranscriptionCommand).input,
    ).not.toHaveProperty("VocabularyName");
    const none: TranscribeApi = {
      send: () => Promise.resolve({}),
      credentials: () => Promise.resolve({}),
    };
    expect(
      await createTranscribe({ region: "r" }, none).transcribe(
        wavFromPcm(new Uint8Array(2), 16000),
      ),
    ).toEqual({
      text: "",
    });
  });

  it("refuses other audio, and reports failures, timeouts and missing credentials", async () => {
    const t = createTranscribe({ region: "r" }, api([]).stub);
    await expect(t.transcribe(wavFromPcm(new Uint8Array(2), 44100))).rejects.toBeInstanceOf(
      SpeechUnavailableError,
    );
    await expect(t.transcribe(new Uint8Array(10))).rejects.toThrow("16 kHz");
    const failing = createTranscribe({ region: "r" }, api(new Error("LimitExceeded")).stub);
    await expect(failing.transcribe(wavFromPcm(new Uint8Array(2), 16000))).rejects.toThrow(
      "Transcribe failed: Error: LimitExceeded",
    );
    const slow: TranscribeApi = {
      send: (_command, options) =>
        new Promise((_resolve, reject) => {
          options?.abortSignal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
      credentials: () => Promise.resolve({}),
    };
    await expect(
      createTranscribe({ region: "r", timeoutMs: 10 }, slow).transcribe(
        wavFromPcm(new Uint8Array(2), 16000),
      ),
    ).rejects.toThrow("took too long");
    expect((await t.status()).available).toBe(true);
    expect((await createTranscribe({ region: "r" }, api([], false).stub).status()).available).toBe(
      false,
    );
  });

  it("builds an SDK client with the default credential chain", async () => {
    const client = transcribeStreaming("us-east-1");
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
        new StartStreamTranscriptionCommand({
          LanguageCode: "en-US",
          MediaEncoding: "pcm",
          MediaSampleRateHertz: 16000,
          AudioStream: audioEvents(new Uint8Array(0)),
        }),
        { abortSignal: aborted.signal },
      ),
    ).rejects.toThrow();
  });
});

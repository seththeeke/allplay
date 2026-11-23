import { afterEach, describe, expect, it, vi } from "vitest";
import { createServices } from "../../src/services/createServices";
import {
  createLocalServerSpeechOutput,
  playBlob,
  silentSpeechOutput,
  type Playback,
  createBrowserSpeechOutput,
  once,
} from "../../src/voice/speechOutput";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(ok = true) {
  const fetchImpl = vi.fn<
    (input: string, init?: RequestInit) => Promise<{ ok: boolean; blob: () => Promise<Blob> }>
  >(() =>
    Promise.resolve({ ok, blob: () => Promise.resolve(new Blob(["RIFF"], { type: "audio/wav" })) }),
  );
  const stops: ReturnType<typeof vi.fn>[] = [];
  const play = vi.fn((): Playback => {
    const stop = vi.fn();
    stops.push(stop);
    return { stop };
  });
  const fallback = { speak: vi.fn() };
  const output = createLocalServerSpeechOutput("http://localhost:4000", fallback, fetchImpl, play);
  return { output, fetchImpl, play, stops, fallback };
}

describe("local server speech output", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks the local server for audio, plays it, and caches it by text and rate", async () => {
    const t = setup();
    t.output.speak("Done.", 1.25);
    await flush();
    expect(t.fetchImpl).toHaveBeenCalledWith("http://localhost:4000/local/speech/synthesize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Done.", rate: 1.25 }),
    });
    expect(t.play).toHaveBeenCalledTimes(1);
    t.output.speak("Done.", 1.25);
    await flush();
    expect(t.fetchImpl).toHaveBeenCalledTimes(1);
    expect(t.stops[0]).toHaveBeenCalled();
    expect(t.play).toHaveBeenCalledTimes(2);
  });

  it("plays only the latest reply when replies overlap", async () => {
    const t = setup();
    t.output.speak("First.", 1);
    t.output.speak("Second.", 1);
    await flush();
    expect(t.play).toHaveBeenCalledTimes(1);
  });

  it("falls back to the browser voice when the server cannot speak, and retries later", async () => {
    const t = setup(false);
    t.output.speak("Hello.", 1);
    await flush();
    expect(t.fallback.speak).toHaveBeenCalledWith("Hello.", 1);
    t.output.speak("Hello.", 1);
    await flush();
    expect(t.fetchImpl).toHaveBeenCalledTimes(2);
    t.output.speak("Old.", 1);
    t.output.speak("New.", 1);
    await flush();
    expect(t.fallback.speak).toHaveBeenLastCalledWith("New.", 1);
  });

  it("plays a clip through an audio element and frees it when stopped", () => {
    const createObjectURL = vi.fn(() => "blob:x");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pauseSpy = vi
      .spyOn(HTMLMediaElement.prototype, "pause")
      .mockImplementation(() => undefined);
    playBlob(new Blob(["RIFF"])).stop();
    expect(playSpy).toHaveBeenCalled();
    expect(pauseSpy).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:x");
    playSpy.mockRestore();
    pauseSpy.mockRestore();
  });

  it("is chosen from the stage config", () => {
    const base = { stage: "LOCAL" as const, dataMode: "MEMORY" as const };
    expect(createServices({ ...base, speechOutput: "OFF" }).speechOutput).toBe(silentSpeechOutput);
    silentSpeechOutput.speak("x", 1);
    expect(
      createServices({ ...base, speechOutput: "LOCAL_SERVER", apiUrl: "http://localhost:4000/" })
        .speechOutput,
    ).not.toBe(silentSpeechOutput);
    expect(createServices({ ...base, speechOutput: "BROWSER" }).speechOutput.speak).toBeTypeOf(
      "function",
    );
  });
});

describe("interruptible speech", () => {
  it("reports the end once when a reply finishes, is replaced or is stopped", async () => {
    const ended: (() => void)[] = [];
    const stop = vi.fn();
    const play = vi.fn((_audio: Blob, onEnd?: () => void): Playback => {
      if (onEnd !== undefined) ended.push(onEnd);
      return { stop };
    });
    const fetchImpl = vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["a"])) }),
    );
    const fallback = { speak: vi.fn() };
    const output = createLocalServerSpeechOutput(
      "http://localhost:4000",
      fallback,
      fetchImpl,
      play,
    );
    const first = vi.fn();
    output.speak("One.", 1, undefined, first);
    await vi.waitFor(() => {
      expect(play).toHaveBeenCalledTimes(1);
    });
    const second = vi.fn();
    output.speak("Two.", 1, undefined, second);
    expect(first).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(play).toHaveBeenCalledTimes(2);
    });
    output.stop?.();
    expect(second).toHaveBeenCalledTimes(1);
    ended[1]?.();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("hands the end callback to the fallback voice", async () => {
    const fallback = { speak: vi.fn() };
    const fetchImpl = vi.fn(() => Promise.reject(new Error("down")));
    const output = createLocalServerSpeechOutput(
      "http://localhost:4000",
      fallback,
      fetchImpl,
      vi.fn(),
    );
    const onEnd = vi.fn();
    output.speak("Hello.", 1, "Joanna", onEnd);
    await vi.waitFor(() => {
      expect(fallback.speak).toHaveBeenCalledWith("Hello.", 1, "Joanna", expect.any(Function));
    });
    (fallback.speak.mock.calls[0] as unknown as [string, number, string, () => void])[3]();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("ignores a late failure after the reply was stopped", async () => {
    const fallback = { speak: vi.fn() };
    let fail: (error: Error) => void = () => undefined;
    const fetchImpl = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          fail = reject;
        }),
    );
    const output = createLocalServerSpeechOutput(
      "http://localhost:4000",
      fallback,
      fetchImpl,
      vi.fn(),
    );
    const onEnd = vi.fn();
    output.speak("Hello.", 1, undefined, onEnd);
    output.stop?.();
    expect(onEnd).toHaveBeenCalledTimes(1);
    fail(new Error("down"));
    await Promise.resolve();
    await Promise.resolve();
    expect(fallback.speak).not.toHaveBeenCalled();
  });

  it("finishes at once with no voice, in the browser and when silent", () => {
    const onEnd = vi.fn();
    createBrowserSpeechOutput({}).speak("Hi.", 1, undefined, onEnd);
    silentSpeechOutput.speak("Hi.", 1, undefined, onEnd);
    silentSpeechOutput.speak("Hi.", 1);
    expect(onEnd).toHaveBeenCalledTimes(2);
    expect(once()).toBeTypeOf("function");
    createBrowserSpeechOutput({}).stop?.();
  });

  it("reports the end of browser speech and cancels it on stop", () => {
    class Utterance {
      rate = 1;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(readonly text: string) {}
    }
    const spoken: Utterance[] = [];
    const synthesis = {
      cancel: vi.fn(),
      speak: vi.fn((utterance: Utterance) => spoken.push(utterance)),
    };
    const output = createBrowserSpeechOutput({
      speechSynthesis: synthesis as unknown as SpeechSynthesis,
      SpeechSynthesisUtterance: Utterance as unknown as typeof SpeechSynthesisUtterance,
    });
    const onEnd = vi.fn();
    output.speak("Hi.", 1, undefined, onEnd);
    spoken[0]?.onend?.();
    spoken[0]?.onerror?.();
    expect(onEnd).toHaveBeenCalledTimes(1);
    output.stop?.();
    expect(synthesis.cancel).toHaveBeenCalledTimes(2);
  });
});

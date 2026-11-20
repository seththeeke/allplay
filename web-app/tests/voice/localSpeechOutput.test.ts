import { afterEach, describe, expect, it, vi } from "vitest";
import { createServices } from "../../src/services/createServices";
import {
  createLocalServerSpeechOutput,
  playBlob,
  silentSpeechOutput,
  type Playback,
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

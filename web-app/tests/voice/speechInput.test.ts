import { describe, expect, it, vi } from "vitest";
import { createLocalServerSpeechInput, typedSpeechInput } from "../../src/voice/speechInput";

describe("speech input", () => {
  it("records, then transcribes on the local server", async () => {
    const wav = new Uint8Array([1, 2, 3]);
    const recording = { stop: vi.fn(() => Promise.resolve(wav)), cancel: vi.fn() };
    const transcribe = vi.fn(() =>
      Promise.resolve({
        text: "deal",
        transcriptSource: "WHISPER" as const,
        provider: "w",
        latencyMs: 3,
      }),
    );
    const input = createLocalServerSpeechInput(transcribe, () => Promise.resolve(recording));
    expect(input.kind).toBe("LOCAL_SERVER");
    const capture = await input.start?.();
    expect(await capture?.stop()).toEqual({ text: "deal", transcriptSource: "WHISPER" });
    expect(transcribe).toHaveBeenCalledWith(wav);
    (await input.start?.())?.cancel();
    expect(recording.cancel).toHaveBeenCalled();
    expect(typedSpeechInput.start).toBeNull();
  });
});

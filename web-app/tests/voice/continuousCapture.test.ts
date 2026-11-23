import { describe, expect, it, vi } from "vitest";
import { SAMPLE_RATE, type AudioEnvironment } from "../../src/voice/audioCapture";
import { startContinuousCapture } from "../../src/voice/continuousCapture";
import { FRAME_SAMPLES } from "../../src/voice/speechDetector";

function fakeAudio() {
  const track = { stop: vi.fn() };
  const port: { onmessage: ((event: MessageEvent<Float32Array>) => void) | null } = {
    onmessage: null,
  };
  const worklet = { port, disconnect: vi.fn() };
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const context = {
    sampleRate: SAMPLE_RATE,
    audioWorklet: { addModule: vi.fn(() => Promise.resolve()) },
    createMediaStreamSource: vi.fn(() => source),
    close: vi.fn(() => Promise.resolve()),
  };
  const env: AudioEnvironment = {
    getUserMedia: vi.fn(() =>
      Promise.resolve({ getTracks: () => [track] } as unknown as MediaStream),
    ),
    createContext: vi.fn(() => context as unknown as AudioContext),
    createWorklet: vi.fn(() => worklet as unknown as AudioWorkletNode),
  };
  const send = (level: number, frames: number) => {
    /* The worklet delivers small blocks, so frames must be assembled across them. */
    const samples = new Float32Array(frames * FRAME_SAMPLES).fill(level);
    for (let at = 0; at < samples.length; at += 128)
      port.onmessage?.({ data: samples.slice(at, at + 128) } as MessageEvent<Float32Array>);
  };
  return { env, send, track, port, worklet, source, context };
}

const handlers = () => ({
  onSpeechStart: vi.fn(),
  onFrame: vi.fn(),
  onSpeechEnd: vi.fn(),
  onDiscard: vi.fn(),
});

describe("continuous capture", () => {
  it("hands over an utterance with the audio from just before it", async () => {
    const audio = fakeAudio();
    const on = handlers();
    await startContinuousCapture(on, 90, audio.env);
    audio.send(0.001, 30);
    expect(on.onFrame).toHaveBeenCalledTimes(30);
    audio.send(0.3, 12);
    expect(on.onSpeechStart).toHaveBeenCalledTimes(1);
    const preRoll = on.onSpeechStart.mock.calls[0]?.[0] as Float32Array[];
    expect(preRoll).toHaveLength(17);
    audio.send(0.001, 3);
    expect(on.onSpeechEnd).toHaveBeenCalledTimes(1);
    const spoken = on.onSpeechEnd.mock.calls[0]?.[0] as Float32Array[];
    expect(spoken.length).toBe(17 + 7 + 3);
    expect(spoken.at(-1)).toHaveLength(FRAME_SAMPLES);
  });

  it("reports a sound too short to be speech", async () => {
    const audio = fakeAudio();
    const on = handlers();
    await startContinuousCapture(on, 60, audio.env);
    audio.send(0.3, 5);
    audio.send(0.001, 2);
    expect(on.onDiscard).toHaveBeenCalledTimes(1);
    expect(on.onSpeechEnd).not.toHaveBeenCalled();
  });

  it("wakes suspended audio on the next input, until stopped", async () => {
    const audio = fakeAudio();
    const resume = vi.fn(() => Promise.resolve());
    Object.assign(audio.context, { state: "suspended", resume });
    const capture = await startContinuousCapture(handlers(), 300, audio.env);
    expect(resume).toHaveBeenCalledTimes(1);
    globalThis.dispatchEvent(new Event("keydown"));
    globalThis.dispatchEvent(new Event("pointerdown"));
    expect(resume).toHaveBeenCalledTimes(3);
    Object.assign(audio.context, { state: "running" });
    globalThis.dispatchEvent(new Event("keydown"));
    expect(resume).toHaveBeenCalledTimes(3);
    Object.assign(audio.context, { state: "suspended" });
    capture.stop();
    globalThis.dispatchEvent(new Event("keydown"));
    expect(resume).toHaveBeenCalledTimes(3);
  });

  it("passes settings on and releases the microphone when stopped", async () => {
    const audio = fakeAudio();
    const on = handlers();
    const capture = await startContinuousCapture(on, 1000, audio.env);
    capture.setSilenceMs(60);
    capture.setSpeaking(true);
    audio.send(0.001, 10);
    audio.send(0.005, 10);
    expect(on.onSpeechStart).not.toHaveBeenCalled();
    capture.setSpeaking(false);
    audio.send(0.3, 12);
    audio.send(0.001, 2);
    expect(on.onSpeechEnd).toHaveBeenCalledTimes(1);
    capture.stop();
    expect(audio.port.onmessage).toBeNull();
    expect(audio.track.stop).toHaveBeenCalled();
    expect(audio.source.disconnect).toHaveBeenCalled();
    expect(audio.worklet.disconnect).toHaveBeenCalled();
    expect(audio.context.close).toHaveBeenCalled();
  });
});

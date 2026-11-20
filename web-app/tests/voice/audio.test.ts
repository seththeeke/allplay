import { describe, expect, it, vi } from "vitest";
import { SAMPLE_RATE, startRecording, type AudioEnvironment } from "../../src/voice/audioCapture";
import { encodeWav } from "../../src/voice/wav";

const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.slice(from, to));

describe("WAV encoding", () => {
  it("writes a 16-bit mono PCM header and clamps samples", () => {
    const wav = encodeWav([new Float32Array([0, 1, -1]), new Float32Array([2, -2])], 16000);
    const view = new DataView(wav.buffer);
    expect(ascii(wav, 0, 4)).toBe("RIFF");
    expect(ascii(wav, 8, 12)).toBe("WAVE");
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(40, true)).toBe(10);
    expect([0, 1, 2, 3, 4].map((i) => view.getInt16(44 + i * 2, true))).toEqual([
      0, 32767, -32768, 32767, -32768,
    ]);
  });
});

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
  const getUserMedia = vi.fn(() =>
    Promise.resolve({ getTracks: () => [track] } as unknown as MediaStream),
  );
  const createContext = vi.fn(() => context as unknown as AudioContext);
  const env: AudioEnvironment = {
    getUserMedia,
    createContext,
    createWorklet: vi.fn(() => worklet as unknown as AudioWorkletNode),
  };
  return { env, getUserMedia, createContext, track, port, worklet, source, context };
}

describe("audio capture", () => {
  it("records 16 kHz mono through the worklet and returns WAV on stop", async () => {
    const audio = fakeAudio();
    const recording = await startRecording(audio.env);
    expect(audio.getUserMedia).toHaveBeenCalledWith({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    expect(audio.createContext).toHaveBeenCalledWith(16000);
    expect(audio.context.audioWorklet.addModule).toHaveBeenCalledWith("/pcm-capture-worklet.js");
    expect(audio.source.connect).toHaveBeenCalledWith(audio.worklet);
    audio.port.onmessage?.({ data: new Float32Array([0.5, -0.5]) } as MessageEvent<Float32Array>);
    const wav = await recording.stop();
    expect(new DataView(wav.buffer).getUint32(40, true)).toBe(4);
    expect(audio.track.stop).toHaveBeenCalled();
    expect(audio.context.close).toHaveBeenCalled();
  });

  it("releases the microphone when cancelled", async () => {
    const audio = fakeAudio();
    (await startRecording(audio.env)).cancel();
    expect(audio.track.stop).toHaveBeenCalled();
  });
});

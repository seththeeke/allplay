import { must } from "../must";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureHandlers } from "../../src/voice/continuousCapture";
import {
  FINAL_TEXT_WAIT_MS,
  localServerListener,
  STREAM_IDLE_MS,
  startTranscribeTurn,
  transcribeListener,
  type ListenHandlers,
  type OpenTranscribeStream,
} from "../../src/voice/continuousListeners";

const handlers = () => ({
  onSpeechStart: vi.fn<ListenHandlers["onSpeechStart"]>(),
  onHeard: vi.fn<ListenHandlers["onHeard"]>(),
  onNothing: vi.fn<ListenHandlers["onNothing"]>(),
  onError: vi.fn<ListenHandlers["onError"]>(),
});

function fakeCapture() {
  let captured: CaptureHandlers | null = null;
  const capture = {
    setSpeaking: vi.fn(),
    setSilenceMs: vi.fn(),
    stop: vi.fn(),
  };
  return {
    capture,
    start: vi.fn((on: CaptureHandlers) => {
      captured = on;
      return Promise.resolve(capture);
    }),
    on: (): CaptureHandlers => {
      if (captured === null) throw new Error("not started");
      return captured;
    },
  };
}

const AUDIO = [new Float32Array([0.5, -0.5, 2, -2])];

describe("local server listener", () => {
  it("sends each finished utterance as WAV and reports what was heard", async () => {
    const fake = fakeCapture();
    const transcribe = vi.fn(() =>
      Promise.resolve({
        text: "deal",
        transcriptSource: "WHISPER" as const,
        provider: "whisper",
        latencyMs: 1,
      }),
    );
    const on = handlers();
    await localServerListener(transcribe, fake.start)(on, 1200);
    fake.on().onFrame(AUDIO[0] as Float32Array);
    fake.on().onSpeechStart(AUDIO);
    expect(on.onSpeechStart).toHaveBeenCalled();
    fake.on().onSpeechEnd(AUDIO);
    await vi.waitFor(() => {
      expect(on.onHeard).toHaveBeenCalledWith({ text: "deal", transcriptSource: "WHISPER" });
    });
    expect((transcribe.mock.calls[0] as unknown as [Uint8Array])[0].length).toBe(44 + 8);
    fake.on().onDiscard();
    expect(on.onNothing).toHaveBeenCalledTimes(1);
  });

  it("treats empty text as nothing and passes on a failure", async () => {
    const fake = fakeCapture();
    const transcribe = vi
      .fn()
      .mockResolvedValueOnce({ text: "  ", transcriptSource: "WHISPER" })
      .mockRejectedValueOnce(new Error("down"));
    const on = handlers();
    await localServerListener(transcribe, fake.start)(on, 1200);
    fake.on().onSpeechEnd(AUDIO);
    await vi.waitFor(() => {
      expect(on.onNothing).toHaveBeenCalled();
    });
    fake.on().onSpeechEnd(AUDIO);
    await vi.waitFor(() => {
      expect(on.onError).toHaveBeenCalled();
    });
  });
});

function fakeStreams() {
  const streams: {
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    text: (text: string, isFinal: boolean) => void;
    fail: (error: unknown) => void;
    closed: () => void;
  }[] = [];
  const open: OpenTranscribeStream = (onText, onError, onClosed) => {
    const stream = {
      send: vi.fn(),
      close: vi.fn(),
      text: onText,
      fail: onError,
      closed: onClosed,
    };
    streams.push(stream);
    return stream;
  };
  return { streams, open };
}

describe("speech-gated Transcribe listener", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function setup() {
    const fake = fakeCapture();
    const { streams, open } = fakeStreams();
    const on = handlers();
    const listener = await transcribeListener(open, fake.start)(on, 1200);
    return { fake, streams, on, listener, audio: fake.on() };
  }

  it("opens no stream until speech, then sends the buffered audio first as PCM", async () => {
    const { streams, audio } = await setup();
    audio.onFrame(AUDIO[0] as Float32Array);
    expect(streams).toHaveLength(0);
    audio.onSpeechStart(AUDIO);
    expect(streams).toHaveLength(1);
    const pcm = streams[0]?.send.mock.calls[0]?.[0] as Uint8Array;
    const view = new DataView(pcm.buffer);
    expect([0, 1, 2, 3].map((i) => view.getInt16(i * 2, true))).toEqual([
      16383, -16384, 32767, -32768,
    ]);
    audio.onFrame(AUDIO[0] as Float32Array);
    expect(streams[0]?.send).toHaveBeenCalledTimes(2);
  });

  it("reports the time from the end of speech to the final text", async () => {
    const fake = fakeCapture();
    const { streams, open } = fakeStreams();
    const latencies: number[] = [];
    let clock = 1000;
    await transcribeListener(
      open,
      fake.start,
      (ms) => latencies.push(ms),
      () => clock,
    )(handlers(), 1200);
    const audio = fake.on();
    audio.onSpeechStart(AUDIO);
    audio.onSpeechEnd(AUDIO);
    clock = 1640;
    streams[0]?.text("deal", true);
    expect(latencies).toEqual([640]);
    /* Nothing heard is no Transcribe sample. */
    audio.onSpeechStart(AUDIO);
    audio.onSpeechEnd(AUDIO);
    vi.advanceTimersByTime(FINAL_TEXT_WAIT_MS);
    expect(latencies).toEqual([640]);
  });

  it("waits for the final text after the player stops", async () => {
    const { streams, on, audio } = await setup();
    audio.onSpeechStart(AUDIO);
    streams[0]?.text("move eight", false);
    audio.onSpeechEnd(AUDIO);
    expect(on.onHeard).not.toHaveBeenCalled();
    streams[0]?.text("move eight to seven", true);
    expect(on.onHeard).toHaveBeenCalledWith({
      text: "move eight to seven",
      transcriptSource: "TRANSCRIBE",
    });
  });

  it("answers at once when the final text arrived first, and uses partial text on timeout", async () => {
    const { streams, on, audio } = await setup();
    audio.onSpeechStart(AUDIO);
    streams[0]?.text("deal", true);
    audio.onSpeechEnd(AUDIO);
    expect(on.onHeard).toHaveBeenLastCalledWith({ text: "deal", transcriptSource: "TRANSCRIBE" });
    audio.onSpeechStart(AUDIO);
    streams[0]?.text("undo", false);
    audio.onSpeechEnd(AUDIO);
    vi.advanceTimersByTime(FINAL_TEXT_WAIT_MS);
    expect(on.onHeard).toHaveBeenLastCalledWith({ text: "undo", transcriptSource: "TRANSCRIBE" });
  });

  it("reuses the stream through pauses and closes it after 15 quiet seconds", async () => {
    const { streams, audio } = await setup();
    audio.onSpeechStart(AUDIO);
    streams[0]?.text("deal", true);
    audio.onSpeechEnd(AUDIO);
    vi.advanceTimersByTime(STREAM_IDLE_MS - 1);
    audio.onSpeechStart(AUDIO);
    expect(streams).toHaveLength(1);
    streams[0]?.text("undo", true);
    audio.onSpeechEnd(AUDIO);
    vi.advanceTimersByTime(STREAM_IDLE_MS);
    expect(streams[0]?.close).toHaveBeenCalledTimes(1);
    audio.onFrame(AUDIO[0] as Float32Array);
    const sent = streams[0]?.send.mock.calls.length;
    audio.onFrame(AUDIO[0] as Float32Array);
    expect(streams[0]?.send.mock.calls.length).toBe(sent);
    audio.onSpeechStart(AUDIO);
    expect(streams).toHaveLength(2);
  });

  it("closes after a false start too, and reports it as nothing", async () => {
    const { streams, on, audio } = await setup();
    audio.onSpeechStart(AUDIO);
    audio.onDiscard();
    expect(on.onNothing).toHaveBeenCalled();
    vi.advanceTimersByTime(STREAM_IDLE_MS);
    expect(streams[0]?.close).toHaveBeenCalled();
  });

  it("settles a waiting utterance when the player speaks again or the stream ends", async () => {
    const { streams, on, audio } = await setup();
    audio.onSpeechStart(AUDIO);
    streams[0]?.text("first", false);
    audio.onSpeechEnd(AUDIO);
    audio.onSpeechStart(AUDIO);
    expect(on.onHeard).toHaveBeenLastCalledWith({ text: "first", transcriptSource: "TRANSCRIBE" });
    streams[0]?.text("second", false);
    audio.onSpeechEnd(AUDIO);
    streams[0]?.closed();
    expect(on.onHeard).toHaveBeenLastCalledWith({ text: "second", transcriptSource: "TRANSCRIBE" });
    streams[0]?.closed();
    expect(on.onHeard).toHaveBeenCalledTimes(2);
  });

  it("recovers from a stream failure with a new stream", async () => {
    const { streams, on, audio } = await setup();
    audio.onSpeechStart(AUDIO);
    streams[0]?.text("deal", false);
    audio.onSpeechEnd(AUDIO);
    streams[0]?.fail(new Error("down"));
    expect(on.onHeard).toHaveBeenCalledWith({ text: "deal", transcriptSource: "TRANSCRIBE" });
    expect(on.onError).toHaveBeenCalled();
    audio.onSpeechStart(AUDIO);
    expect(streams).toHaveLength(2);
    streams[1]?.fail(new Error("again"));
    expect(on.onError).toHaveBeenCalledTimes(2);
  });

  it("reports nothing when the stream heard no words", async () => {
    const { on, audio } = await setup();
    audio.onSpeechStart(AUDIO);
    audio.onSpeechEnd(AUDIO);
    vi.advanceTimersByTime(FINAL_TEXT_WAIT_MS);
    expect(on.onNothing).toHaveBeenCalledTimes(1);
  });

  it("passes settings through and closes everything when stopped", async () => {
    const { fake, streams, on, listener, audio } = await setup();
    listener.setSpeaking(true);
    listener.setSilenceMs(900);
    expect(fake.capture.setSpeaking).toHaveBeenCalledWith(true);
    expect(fake.capture.setSilenceMs).toHaveBeenCalledWith(900);
    audio.onSpeechStart(AUDIO);
    streams[0]?.text("deal", false);
    audio.onSpeechEnd(AUDIO);
    listener.stop();
    vi.advanceTimersByTime(FINAL_TEXT_WAIT_MS + STREAM_IDLE_MS);
    expect(streams[0]?.close).toHaveBeenCalledTimes(1);
    expect(fake.capture.stop).toHaveBeenCalled();
    expect(on.onHeard).not.toHaveBeenCalled();
  });
});

describe("turn-based live Transcribe", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function turn(clock = () => 0, latencies: number[] = []) {
    const fake = fakeCapture();
    const { streams, open } = fakeStreams();
    const events = { silenceMs: 800, onPartial: vi.fn(), onSpeechEnd: vi.fn() };
    const capture = await startTranscribeTurn(
      open,
      events,
      fake.start,
      (ms) => latencies.push(ms),
      clock,
    );
    return { fake, stream: must(streams[0]), events, capture, audio: fake.on() };
  }

  it("streams every frame, reports partial text, and ends on a pause only after a final segment", async () => {
    const { fake, stream, events, audio } = await turn();
    expect(fake.start).toHaveBeenCalledWith(expect.anything(), 800);
    audio.onFrame(AUDIO[0] as Float32Array);
    expect(stream.send).toHaveBeenCalledTimes(1);
    audio.onSpeechStart(AUDIO);
    audio.onDiscard();
    stream.text("three", false);
    expect(events.onPartial).toHaveBeenLastCalledWith("three");
    audio.onSpeechEnd(AUDIO);
    expect(events.onSpeechEnd).not.toHaveBeenCalled();
    stream.text("three to seven", true);
    stream.text("please", false);
    expect(events.onPartial).toHaveBeenLastCalledWith("three to seven please");
    audio.onSpeechEnd(AUDIO);
    expect(events.onSpeechEnd).toHaveBeenCalledTimes(1);
  });

  it("stops the microphone, waits for the last final text, and reports the latency", async () => {
    let now = 100;
    const latencies: number[] = [];
    const { fake, stream, capture } = await turn(() => now, latencies);
    stream.text("deal", false);
    const heard = capture.stop();
    expect(fake.capture.stop).toHaveBeenCalled();
    expect(stream.close).toHaveBeenCalled();
    now = 450;
    stream.text("deal", true);
    stream.closed();
    expect(await heard).toEqual({ text: "deal", transcriptSource: "TRANSCRIBE" });
    expect(latencies).toEqual([350]);
  });

  it("gives up waiting after the final text timeout and keeps the partial text", async () => {
    const { stream, capture } = await turn();
    stream.text("undo", false);
    const heard = capture.stop();
    vi.advanceTimersByTime(FINAL_TEXT_WAIT_MS);
    expect(await heard).toEqual({ text: "undo", transcriptSource: "TRANSCRIBE" });
  });

  it("fails a turn whose stream failed before hearing anything, and cancels without waiting", async () => {
    const first = await turn();
    first.stream.fail(new Error("socket closed"));
    await expect(first.capture.stop()).rejects.toThrow("socket closed");
    const second = await turn();
    second.stream.fail("odd");
    await expect(second.capture.stop()).rejects.toThrow("Transcribe failed.");
    const third = await turn();
    third.stream.text("deal", true);
    third.stream.fail(new Error("late"));
    expect((await third.capture.stop()).text).toBe("deal");
    const fourth = await turn();
    fourth.capture.cancel();
    expect(fourth.fake.capture.stop).toHaveBeenCalled();
    expect(fourth.stream.close).toHaveBeenCalled();
  });

  it("closes the stream when the microphone cannot open", async () => {
    const { streams, open } = fakeStreams();
    await expect(
      startTranscribeTurn(open, { silenceMs: 800 }, () => Promise.reject(new Error("denied"))),
    ).rejects.toThrow("denied");
    expect(streams[0]?.close).toHaveBeenCalled();
  });
});

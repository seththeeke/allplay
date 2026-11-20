import { describe, expect, it, vi } from "vitest";
import { createKokoro, startWorker, type WorkerProcess } from "../../../src/service/speech/kokoro";
import { isWav } from "../../../src/service/speech/speechToText";
import {
  createRecordingTts,
  createUnavailableTts,
  silentWav,
  SpeechOutputUnavailableError,
} from "../../../src/service/speech/textToSpeech";

/** A worker that answers each request with `answer(request)`, or stays silent when it returns null. */
function fakeWorker(
  answer: (request: { id: number; text: string; speed: number; voice: string }) => object | null,
) {
  let listener: (line: string) => void = () => undefined;
  let exit: () => void = () => undefined;
  const sent: string[] = [];
  const worker: WorkerProcess = {
    send: (line) => {
      sent.push(line);
      const reply = answer(JSON.parse(line) as never);
      if (reply !== null)
        queueMicrotask(() => {
          listener(JSON.stringify(reply));
        });
    },
    onLine: (next) => {
      listener = next;
    },
    onExit: (next) => {
      exit = next;
    },
  };
  return {
    worker,
    sent,
    emit: (line: string) => {
      listener(line);
    },
    exit: () => {
      exit();
    },
  };
}

const OPTIONS = {
  python: "/nope/python",
  worker: "worker.py",
  model: "/nope/model.onnx",
  voices: "/nope/voices.bin",
  voice: "af_heart",
};

describe("Kokoro", () => {
  it("starts one worker, sends text, speed and voice, and returns the WAV", async () => {
    const wav = Buffer.from(silentWav(10));
    const fake = fakeWorker((request) => ({ id: request.id, wav: wav.toString("base64") }));
    const start = vi.fn(() => fake.worker);
    const tts = createKokoro(OPTIONS, start);
    expect(isWav(await tts.synthesize("Done.", 1.25))).toBe(true);
    await tts.synthesize("Again.", 1);
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith("/nope/python", [
      "worker.py",
      "/nope/model.onnx",
      "/nope/voices.bin",
    ]);
    expect(JSON.parse(fake.sent[0] ?? "")).toEqual({
      id: 1,
      text: "Done.",
      speed: 1.25,
      voice: "af_heart",
    });
  });

  it("reports worker errors, ignores stray lines, and restarts after the worker exits", async () => {
    const fake = fakeWorker((request) =>
      request.text === "hang" ? null : { id: request.id, error: "bad text" },
    );
    const start = vi.fn(() => fake.worker);
    const tts = createKokoro({ ...OPTIONS, timeoutMs: 20 }, start);
    await expect(tts.synthesize("x", 1)).rejects.toThrow("Kokoro failed: bad text");
    fake.emit("not json");
    fake.emit(JSON.stringify({ id: 99, wav: "" }));
    await expect(tts.synthesize("hang", 1)).rejects.toThrow("took too long");
    const waiting = tts.synthesize("hang", 1);
    fake.exit();
    await expect(waiting).rejects.toBeInstanceOf(SpeechOutputUnavailableError);
    await expect(tts.synthesize("x", 1)).rejects.toThrow("bad text");
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("is unavailable until setup has run", async () => {
    expect(await createKokoro(OPTIONS).status()).toMatchObject({ available: false });
    expect(
      await createKokoro({
        ...OPTIONS,
        python: process.execPath,
        model: process.execPath,
        voices: process.execPath,
      }).status(),
    ).toEqual({ available: true, detail: "Kokoro-82M, voice af_heart." });
  });

  it("runs a real worker process over stdin and stdout", async () => {
    const worker = startWorker(process.execPath, [
      "-e",
      "process.stdin.on('data', (d) => process.stdout.write(d)); setTimeout(() => process.exit(0), 300);",
    ]);
    const lines: string[] = [];
    worker.onLine((line) => lines.push(line));
    const exited = new Promise<void>((resolve) => {
      worker.onExit(resolve);
    });
    worker.send('{"echo":1}');
    await exited;
    expect(lines).toEqual(['{"echo":1}']);
  });
});

describe("recording and unavailable text to speech", () => {
  it("records what it would say and returns silence", async () => {
    const tts = createRecordingTts();
    expect((await tts.status()).available).toBe(true);
    expect(isWav(await tts.synthesize("Hello there.", 1))).toBe(true);
    expect(tts.spoken).toEqual(["Hello there."]);
    expect(silentWav().length).toBe(44 + 3200);
  });

  it("fails as unavailable with its reason", async () => {
    const tts = createUnavailableTts("polly", "later");
    expect(await tts.status()).toEqual({ available: false, detail: "later" });
    await expect(tts.synthesize("x", 1)).rejects.toThrow("later");
  });
});

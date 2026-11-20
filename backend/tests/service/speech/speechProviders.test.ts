import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  exists,
  runCommand,
  withTempWav,
  type CommandRunner,
} from "../../../src/service/speech/commandRunner";
import { createMacosSpeech } from "../../../src/service/speech/macosSpeech";
import { isWav, SpeechUnavailableError } from "../../../src/service/speech/speechToText";
import { createTypedOnly } from "../../../src/service/speech/typedOnly";
import { createWhisperCpp } from "../../../src/service/speech/whisperCpp";
import { silentWav } from "./fakeSpeech";

const wav = silentWav();

function fakeApp(): string {
  const app = join(mkdtempSync(join(tmpdir(), "allplay-app-")), "AllPlaySpeech.app");
  mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
  writeFileSync(join(app, "Contents", "MacOS", "allplay-macos-speech"), "");
  return app;
}

/** A runner that plays the helper: writes `result` to the output path argument. */
const helper = (result: string | null, code = 0): CommandRunner =>
  vi.fn((_command: string, args: readonly string[]) => {
    if (result !== null) writeFileSync(args.at(-1) as string, result);
    return Promise.resolve({ code, stdout: "", stderr: code === 0 ? "" : "launch failed" });
  });

describe("speech helpers", () => {
  it("recognizes WAV headers", () => {
    expect(isWav(wav)).toBe(true);
    expect(
      isWav(new TextEncoder().encode("not audio at all, just some text that is long enough")),
    ).toBe(false);
    expect(isWav(wav.slice(0, 20))).toBe(false);
  });

  it("runs commands, including missing ones, and cleans up temporary audio", async () => {
    expect(
      await runCommand("node", ["-e", "process.stdout.write('hi'); process.stderr.write('err')"]),
    ).toEqual({
      code: 0,
      stdout: "hi",
      stderr: "err",
    });
    expect((await runCommand("node", ["-e", "process.exit(3)"])).code).toBe(3);
    expect((await runCommand("definitely-not-a-command-allplay", [])).code).toBe(127);
    expect(
      (await runCommand("node", ["-e", "setTimeout(() => {}, 5000)"], { timeoutMs: 50 })).code,
    ).toBe(124);
    expect(
      (await runCommand("node", ["-e", "process.stdout.write(process.cwd())"], { cwd: "/" }))
        .stdout,
    ).toBe("/");
    let kept = "";
    await withTempWav(wav, async (path) => {
      kept = path;
      expect(await exists(path)).toBe(true);
    });
    expect(await exists(kept)).toBe(false);
  });
});

describe("macOS speech", () => {
  it("reports why it is unavailable", async () => {
    expect(await createMacosSpeech("/nope", helper(null), "linux").status()).toMatchObject({
      available: false,
      detail: "macOS speech needs macOS.",
    });
    expect((await createMacosSpeech("/nope", helper(null), "darwin").status()).detail).toMatch(
      /setup:speech:macos/,
    );
    expect(await createMacosSpeech(fakeApp(), helper(null), "darwin").status()).toMatchObject({
      available: true,
    });
  });

  it("launches the app with open and reads its result file", async () => {
    const run = helper('{"text":"  Move 3 to 7 "}');
    const app = fakeApp();
    expect(await createMacosSpeech(app, run, "darwin").transcribe(wav)).toEqual({
      text: "Move 3 to 7",
    });
    expect(run).toHaveBeenCalledWith("open", [
      "-W",
      "-n",
      "-g",
      "-j",
      app,
      "--args",
      expect.stringMatching(/clip\.wav$/),
      expect.stringMatching(/result\.json$/),
    ]);
  });

  it("turns failures into SpeechUnavailableError", async () => {
    const app = fakeApp();
    await expect(
      createMacosSpeech(app, helper('{"error":"not authorized"}'), "darwin").transcribe(wav),
    ).rejects.toThrow(/not authorized/);
    await expect(createMacosSpeech(app, helper(null), "darwin").transcribe(wav)).rejects.toThrow(
      /no result/,
    );
    await expect(
      createMacosSpeech(app, helper(null, 1), "darwin").transcribe(wav),
    ).rejects.toBeInstanceOf(SpeechUnavailableError);
  });
});

describe("whisper.cpp", () => {
  const model = join(mkdtempSync(join(tmpdir(), "allplay-model-")), "ggml-base.en.bin");
  writeFileSync(model, "model");
  const runner = (code: number, stdout = ""): CommandRunner =>
    vi.fn(() => Promise.resolve({ code, stdout, stderr: code === 0 ? "" : "boom" }));

  it("reports a missing binary or model", async () => {
    expect((await createWhisperCpp({ binary: "x", model }, runner(127)).status()).detail).toMatch(
      /whisper-cli not found/,
    );
    expect(
      (await createWhisperCpp({ binary: "x", model: "/nope" }, runner(0)).status()).detail,
    ).toMatch(/Model missing/);
    expect(await createWhisperCpp({ binary: "x", model }, runner(0)).status()).toMatchObject({
      available: true,
    });
  });

  it("transcribes with the model and tidies whitespace", async () => {
    const run = runner(0, "\n Deal another row\n of cards.\n");
    expect(await createWhisperCpp({ binary: "whisper-cli", model }, run).transcribe(wav)).toEqual({
      text: "Deal another row of cards.",
    });
    expect(run).toHaveBeenCalledWith("whisper-cli", [
      "-m",
      model,
      "-f",
      expect.stringMatching(/clip\.wav$/),
      "-l",
      "en",
      "-nt",
      "-np",
    ]);
    await expect(
      createWhisperCpp({ binary: "x", model }, runner(1)).transcribe(wav),
    ).rejects.toThrow(/whisper.cpp failed: boom/);
  });
});

describe("typed only", () => {
  it("accepts no audio", async () => {
    const typed = createTypedOnly();
    expect(typed.transcriptSource).toBe("TYPED");
    expect((await typed.status()).available).toBe(false);
    await expect(typed.transcribe(wav)).rejects.toThrow(/Typed commands only/);
  });
});

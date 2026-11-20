import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../../src/logger";
import { createLocalProviders } from "../../src/local/providers";
import { resolveSettings } from "../../src/local/settings";
import { fakeSpeech } from "../service/speech/fakeSpeech";

const logger = createLogger({ write: vi.fn() });

describe("local settings", () => {
  it("applies presets and lets explicit variables override them", () => {
    expect(resolveSettings({})).toMatchObject({
      preset: "local",
      llm: "claude-code",
      speechIn: "auto",
      speechOut: "kokoro",
      port: 4000,
    });
    expect(resolveSettings({ ALLPLAY_PRESET: "local-aws" })).toMatchObject({
      llm: "bedrock",
      speechIn: "transcribe",
      speechOut: "polly",
    });
    expect(
      resolveSettings({
        ALLPLAY_PRESET: "continuous-integration",
        ALLPLAY_SPEECH_IN: "whisper",
        PORT: "4100",
      }),
    ).toMatchObject({
      llm: "fake",
      speechIn: "whisper",
      port: 4100,
    });
    expect(() => resolveSettings({ ALLPLAY_PRESET: "nope" })).toThrow();
    expect(() => resolveSettings({ ALLPLAY_LLM: "gpt" })).toThrow();
  });

  it("chooses the first available speech provider, reporting the one asked for when none is", async () => {
    const pick = async (
      env: Record<string, string>,
      candidates?: ReturnType<typeof fakeSpeech>[],
    ) =>
      createLocalProviders(resolveSettings(env), env, {
        logger,
        ...(candidates === undefined ? {} : { speechCandidates: candidates }),
      });
    expect(
      (await pick({}, [fakeSpeech("", false, "a"), fakeSpeech("x", true, "b")])).speechToText.name,
    ).toBe("b");
    const none = await pick({ ALLPLAY_SPEECH_IN: "whisper" }, [
      fakeSpeech("", false, "whisper.cpp"),
    ]);
    expect(none.speechToText.name).toBe("typed");
    expect((await none.status())["speechIn"]).toMatchObject({
      provider: "whisper.cpp",
      available: false,
    });
    expect((await pick({ ALLPLAY_SPEECH_IN: "typed" })).speechToText.name).toBe("typed");
    /* Transcribe's availability depends on the machine's AWS credentials, so only the provider is asserted. */
    for (const env of [
      { ALLPLAY_SPEECH_IN: "transcribe" },
      {
        ALLPLAY_SPEECH_IN: "transcribe",
        ALLPLAY_TRANSCRIBE_VOCABULARY: "allplay-vocabulary-local",
      },
    ]) {
      const transcribe = await pick(env);
      expect((await transcribe.status())["speechIn"]?.provider).toBe("transcribe");
    }
    const fallback = await pick({
      ALLPLAY_SPEECH_IN: "macos",
      ALLPLAY_WHISPER_BIN: "nope-whisper",
    });
    expect(["macos-speech", "typed"]).toContain(fallback.speechToText.name);
    const auto = await pick({
      ALLPLAY_WHISPER_BIN: "nope-whisper",
      ALLPLAY_WHISPER_MODEL: "/nope",
    });
    expect(auto.speechToText.name).not.toBe("whisper.cpp");
  });
});

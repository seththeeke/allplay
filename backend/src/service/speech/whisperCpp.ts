import { exists, runCommand, withTempWav, type CommandRunner } from "./commandRunner";
import { SpeechUnavailableError, type SpeechToText } from "./speechToText";

export interface WhisperOptions {
  binary: string;
  model: string;
}

/** whisper.cpp's `whisper-cli` with an English model (local-development.md section 4). */
export function createWhisperCpp(
  options: WhisperOptions,
  run: CommandRunner = runCommand,
): SpeechToText {
  return {
    name: "whisper.cpp",
    transcriptSource: "WHISPER",
    status: async () => {
      const probe = await run(options.binary, ["--help"]);
      if (probe.code === 127) {
        return {
          available: false,
          detail: "whisper-cli not found. Run npm run setup:speech:whisper in backend/.",
        };
      }
      if (!(await exists(options.model))) {
        return {
          available: false,
          detail: `Model missing at ${options.model}. Run npm run setup:speech:whisper.`,
        };
      }
      return { available: true, detail: "whisper.cpp with the base English model." };
    },
    transcribe: (wav) =>
      withTempWav(wav, async (path) => {
        const result = await run(options.binary, [
          "-m",
          options.model,
          "-f",
          path,
          "-l",
          "en",
          "-nt",
          "-np",
        ]);
        if (result.code !== 0)
          throw new SpeechUnavailableError(
            `whisper.cpp failed: ${result.stderr.trim() || "no detail"}`,
          );
        return { text: result.stdout.replace(/\s+/g, " ").trim() };
      }),
  };
}

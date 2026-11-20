import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { exists, runCommand, withTempWav, type CommandRunner } from "./commandRunner";
import { SpeechUnavailableError, type SpeechToText } from "./speechToText";

const HelperOutputSchema = z.union([
  z.object({ text: z.string() }),
  z.object({ error: z.string() }),
]);

/**
 * Apple's on-device speech recognition through AllPlaySpeech.app, built by
 * `npm run setup:speech:macos` (local-development.md section 4). The app is
 * launched with `open` so macOS grants speech permission to it, not to the
 * terminal running the server; it writes its result to a file.
 */
export function createMacosSpeech(
  appPath: string,
  run: CommandRunner = runCommand,
  platform: string = process.platform,
): SpeechToText {
  return {
    name: "macos-speech",
    transcriptSource: "MACOS_SPEECH",
    status: async () => {
      if (platform !== "darwin") return { available: false, detail: "macOS speech needs macOS." };
      if (!(await exists(join(appPath, "Contents", "MacOS", "allplay-macos-speech")))) {
        return {
          available: false,
          detail: "Not built. Run npm run setup:speech:macos in backend/.",
        };
      }
      return { available: true, detail: "Apple on-device speech recognition." };
    },
    transcribe: (wav) =>
      withTempWav(wav, async (path) => {
        const output = join(dirname(path), "result.json");
        const result = await run("open", ["-W", "-n", "-g", "-j", appPath, "--args", path, output]);
        if (result.code !== 0)
          throw new SpeechUnavailableError(`macOS speech did not start: ${result.stderr.trim()}`);
        const raw = (await exists(output))
          ? await readFile(output, "utf8")
          : '{"error":"no result"}';
        const parsed = HelperOutputSchema.parse(JSON.parse(raw));
        if ("error" in parsed)
          throw new SpeechUnavailableError(`macOS speech failed: ${parsed.error}`);
        return { text: parsed.text.trim() };
      }),
  };
}

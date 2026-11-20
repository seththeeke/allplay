import { z } from "zod";

/** Capability settings and presets (local-development.md section 2.1). */
export const PRESETS = {
  local: { storage: "memory", llm: "claude-code", speechIn: "auto", speechOut: "kokoro" },
  "local-aws": { storage: "memory", llm: "bedrock", speechIn: "transcribe", speechOut: "polly" },
  "continuous-integration": {
    storage: "memory",
    llm: "fake",
    speechIn: "typed",
    speechOut: "recording",
  },
} as const;

const SettingsSchema = z.object({
  preset: z.enum(["local", "local-aws", "continuous-integration"]),
  storage: z.enum(["memory"]),
  llm: z.enum(["claude-code", "claude-api", "bedrock", "fake"]),
  speechIn: z.enum(["auto", "macos", "whisper", "transcribe", "typed"]),
  speechOut: z.enum(["kokoro", "polly", "recording"]),
  port: z.coerce.number().int().min(0).max(65535),
  webOrigin: z.string().min(1),
});
export type LocalSettings = z.infer<typeof SettingsSchema>;

/** Reads the preset, then lets any capability variable set explicitly override it. Invalid values throw at startup. */
export function resolveSettings(env: Readonly<Record<string, string | undefined>>): LocalSettings {
  const preset = (env["ALLPLAY_PRESET"] ?? "local") as keyof typeof PRESETS;
  const base =
    (PRESETS as Record<string, (typeof PRESETS)[keyof typeof PRESETS] | undefined>)[preset] ??
    PRESETS.local;
  return SettingsSchema.parse({
    preset,
    storage: env["ALLPLAY_STORAGE"] ?? base.storage,
    llm: env["ALLPLAY_LLM"] ?? base.llm,
    speechIn: env["ALLPLAY_SPEECH_IN"] ?? base.speechIn,
    speechOut: env["ALLPLAY_SPEECH_OUT"] ?? base.speechOut,
    port: env["PORT"] ?? 4000,
    webOrigin: env["ALLPLAY_WEB_ORIGIN"] ?? "http://localhost:5173",
  });
}

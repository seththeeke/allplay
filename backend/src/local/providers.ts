import { fileURLToPath } from "node:url";
import { createDecisionsHandler } from "../controller/web-api/decisions/decisionsController";
import { createHealthHandler } from "../controller/web-api/health/healthController";
import type { HttpResult } from "../controller/web-api/shared/response";
import { createInMemoryDecisionDao } from "../dao/decision/inMemoryDecisionDao";
import { logger as rootLogger, type Logger } from "../logger";
import { createDecisionService, type DecisionService } from "../service/decision/decisionService";
import { createHealthService } from "../service/healthService";
import { createMacosSpeech } from "../service/speech/macosSpeech";
import type { ProviderStatus, SpeechToText } from "../service/speech/speechToText";
import { createTypedOnly } from "../service/speech/typedOnly";
import { createWhisperCpp } from "../service/speech/whisperCpp";
import type { LocalSettings } from "./settings";

export const LOCAL_DIR = fileURLToPath(new URL("../../.local/", import.meta.url));

export type Handler = (event: unknown) => Promise<HttpResult>;

export interface CapabilityStatus extends ProviderStatus {
  setting: string;
  provider: string;
}

/** Everything the local server serves, built in one place (action-decision.md section 16). */
export interface LocalProviders {
  settings: LocalSettings;
  speechToText: SpeechToText;
  decisions: DecisionService;
  handlers: { health: Handler; decisions: Handler };
  status(): Promise<Record<string, CapabilityStatus>>;
  /** Drops all in-memory state, for tests (POST /local/reset). */
  reset(): void;
}

export interface ProviderOverrides {
  speechCandidates?: SpeechToText[];
  logger?: Logger;
  now?: () => Date;
}

const notYet = (setting: string, leg: string): CapabilityStatus => ({
  setting,
  provider: "none",
  available: false,
  detail: `Arrives with ${leg}.`,
});

/** The speech candidates for a setting, in preference order; `auto` tries macOS speech, then whisper.cpp. */
function speechCandidates(
  settings: LocalSettings,
  env: Readonly<Record<string, string | undefined>>,
): SpeechToText[] {
  const macos = createMacosSpeech(`${LOCAL_DIR}AllPlaySpeech.app`);
  const whisper = createWhisperCpp({
    binary: env["ALLPLAY_WHISPER_BIN"] ?? "whisper-cli",
    model: env["ALLPLAY_WHISPER_MODEL"] ?? `${LOCAL_DIR}models/ggml-base.en.bin`,
  });
  if (settings.speechIn === "auto") return [macos, whisper];
  if (settings.speechIn === "macos") return [macos];
  if (settings.speechIn === "whisper") return [whisper];
  if (settings.speechIn === "transcribe")
    return [createTypedOnly("Server-side Transcribe arrives with AD-15.")];
  return [createTypedOnly()];
}

/** The composition root of the local server: reads settings and builds every provider and service. */
export async function createLocalProviders(
  settings: LocalSettings,
  env: Readonly<Record<string, string | undefined>> = process.env,
  overrides: ProviderOverrides = {},
): Promise<LocalProviders> {
  const logger = overrides.logger ?? rootLogger.child({ runtime: "local-server" });
  const candidates = overrides.speechCandidates ?? speechCandidates(settings, env);
  let speechToText = createTypedOnly();
  for (const candidate of candidates) {
    if ((await candidate.status()).available) {
      speechToText = candidate;
      break;
    }
  }
  const unavailable =
    candidates.length === 1 && speechToText.name === "typed"
      ? (candidates[0] as SpeechToText)
      : speechToText;
  const build = () => {
    const decisions = createDecisionService({
      dao: createInMemoryDecisionDao(),
      ...(overrides.now ? { now: overrides.now } : {}),
    });
    return {
      decisions,
      handlers: {
        health: createHealthHandler({
          health: createHealthService("LOCAL"),
          logger: logger.child({ bundle: "health" }),
        }),
        decisions: createDecisionsHandler({
          decisions,
          logger: logger.child({ bundle: "decisions" }),
        }),
      },
    };
  };
  let built = build();
  const providers: LocalProviders = {
    settings,
    speechToText,
    get decisions() {
      return built.decisions;
    },
    get handlers() {
      return built.handlers;
    },
    status: async () => ({
      storage: {
        setting: settings.storage,
        provider: "in-memory",
        available: true,
        detail: "State lasts until the server stops.",
      },
      llm: notYet(settings.llm, "AD-14 (Claude API) and AD-2 to AD-5 (decider layers)"),
      speechIn: {
        setting: settings.speechIn,
        provider: unavailable.name,
        ...(await unavailable.status()),
      },
      speechOut: notYet(settings.speechOut, "AD-13"),
    }),
    reset: () => {
      built = build();
    },
  };
  return providers;
}

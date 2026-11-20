import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createDecisionsHandler } from "../controller/web-api/decisions/decisionsController";
import { createGameHandler } from "../controller/web-api/game/gameController";
import { createHealthHandler } from "../controller/web-api/health/healthController";
import type { HttpResult } from "../controller/web-api/shared/response";
import { createInMemoryDecisionDao } from "../dao/decision/inMemoryDecisionDao";
import { createInMemoryGameSessionDao } from "../dao/gameSession/inMemoryGameSessionDao";
import { createInMemorySeatAssignmentDao } from "../dao/seatAssignment/inMemorySeatAssignmentDao";
import { createBundledRulesRepository } from "../game-catalog";
import { logger as rootLogger, type Logger } from "../logger";
import { createDecisionService, type DecisionService } from "../service/decision/decisionService";
import { readApiKey } from "../service/decision/llm/apiKey";
import { createClaudeApiLlm, DEFAULT_CLAUDE_MODEL } from "../service/decision/llm/claudeApi";
import { createClaudeCodeLlm } from "../service/decision/llm/claudeCode";
import { createFakeLlm, createUnavailableLlm } from "../service/decision/llm/fakeLlm";
import type { LlmClient } from "../service/decision/llm/llmClient";
import {
  createGameSessionService,
  type GameSessionService,
} from "../service/gameSession/gameSessionService";
import { createHealthService } from "../service/healthService";
import { createMacosSpeech } from "../service/speech/macosSpeech";
import type { ProviderStatus, SpeechToText } from "../service/speech/speechToText";
import { createTypedOnly } from "../service/speech/typedOnly";
import { createKokoro } from "../service/speech/kokoro";
import {
  createRecordingTts,
  createUnavailableTts,
  type TextToSpeech,
} from "../service/speech/textToSpeech";
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
  textToSpeech: TextToSpeech;
  llm: LlmClient;
  decisions: DecisionService;
  sessions: GameSessionService;
  handlers: { health: Handler; decisions: Handler; game: Handler };
  status(): Promise<Record<string, CapabilityStatus>>;
  /** Drops all in-memory state and the fixed seed, for tests (POST /local/reset). */
  reset(): void;
  /** Fixes the seed of every game started from now on, or clears it (POST /local/seed). */
  setSeed(seed: string | null): void;
}

export interface ProviderOverrides {
  speechCandidates?: SpeechToText[];
  logger?: Logger;
  llm?: LlmClient;
  textToSpeech?: TextToSpeech;
  /** The seed of games started while no seed is fixed; random by default. */
  newSeed?: () => string;
  now?: () => Date;
}

const randomSeed = (): string => randomBytes(16).toString("hex");

/** Text to speech for a setting (action-decision.md section 13). */
function speechOutput(
  settings: LocalSettings,
  env: Readonly<Record<string, string | undefined>>,
): TextToSpeech {
  if (settings.speechOut === "recording") return createRecordingTts();
  if (settings.speechOut === "polly")
    return createUnavailableTts("polly", "Polly on the local server arrives with AD-15.");
  return createKokoro({
    python: `${LOCAL_DIR}kokoro/venv/bin/python`,
    worker: fileURLToPath(new URL("./kokoro/worker.py", import.meta.url)),
    model: `${LOCAL_DIR}kokoro/kokoro-v1.0.onnx`,
    voices: `${LOCAL_DIR}kokoro/voices-v1.0.bin`,
    voice: env["ALLPLAY_KOKORO_VOICE"] ?? "af_heart",
  });
}

/** The language model for a setting (action-decision.md section 8). */
function languageModel(
  settings: LocalSettings,
  env: Readonly<Record<string, string | undefined>>,
): LlmClient {
  if (settings.llm === "fake") return createFakeLlm();
  if (settings.llm === "bedrock")
    return createUnavailableLlm("bedrock", "Bedrock arrives with AD-15.");
  const model = env["ALLPLAY_CLAUDE_MODEL"] ?? DEFAULT_CLAUDE_MODEL;
  if (settings.llm === "claude-code")
    return createClaudeCodeLlm({ binary: env["ALLPLAY_CLAUDE_BIN"] ?? "claude", model });
  return createClaudeApiLlm({ apiKey: readApiKey(env, `${LOCAL_DIR}anthropic-api-key`), model });
}

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
  const llm = overrides.llm ?? languageModel(settings, env);
  const textToSpeech = overrides.textToSpeech ?? speechOutput(settings, env);
  /* Kokoro loads its model on first use; warm it now so the first reply is quick. */
  if (textToSpeech.name === "kokoro" && (await textToSpeech.status()).available)
    void textToSpeech.synthesize("Ready.", 1).catch(() => undefined);
  const repository = createBundledRulesRepository();
  let fixedSeed: string | null = null;
  const build = () => {
    const sessions = createGameSessionService({
      dao: createInMemoryGameSessionDao(),
      seats: createInMemorySeatAssignmentDao(),
      games: (gameId, version) => repository.compiled(gameId, version),
      ...(overrides.now ? { now: overrides.now } : {}),
      newSeed: () => fixedSeed ?? (overrides.newSeed ?? randomSeed)(),
    });
    const decisions = createDecisionService({
      dao: createInMemoryDecisionDao(),
      llm,
      sessions,
      catalog: () => repository.list(),
      guidance: async (gameId, version) =>
        (await repository.get(gameId, version)).speech.deciderGuidance ?? [],
      ...(overrides.now ? { now: overrides.now } : {}),
    });
    return {
      decisions,
      sessions,
      handlers: {
        game: createGameHandler({
          catalog: repository,
          sessions,
          logger: logger.child({ bundle: "game" }),
        }),
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
    textToSpeech,
    llm,
    get decisions() {
      return built.decisions;
    },
    get sessions() {
      return built.sessions;
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
      llm: { setting: settings.llm, provider: llm.name, ...(await llm.status()) },
      speechIn: {
        setting: settings.speechIn,
        provider: unavailable.name,
        ...(await unavailable.status()),
      },
      speechOut: {
        setting: settings.speechOut,
        provider: textToSpeech.name,
        ...(await textToSpeech.status()),
      },
    }),
    reset: () => {
      fixedSeed = null;
      built = build();
    },
    setSeed: (seed) => {
      fixedSeed = seed;
    },
  };
  return providers;
}

import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Decision } from "../models/decision";
import { createLoggerTurnLog, createRecentTurnLog } from "../service/decision/turnLog";
import { createInMemoryMetricRollupDao } from "../dao/metricRollup/inMemoryMetricRollupDao";
import { createMetricsAdminService } from "../service/admin/metricsAdminService";
import { createDecisionsHandler } from "../controller/web-api/decisions/decisionsController";
import { createGameHandler } from "../controller/web-api/game/gameController";
import { createHealthHandler } from "../controller/web-api/health/healthController";
import { createPlayersHandler } from "../controller/web-api/players/playersController";
import { createAdminHandler } from "../controller/web-api/admin/adminController";
import { createInMemoryDeploymentPipeline } from "../dao/pipeline/inMemoryDeploymentPipeline";
import { createDeploymentService } from "../service/admin/deploymentService";
import { createAccountAdminService } from "../service/admin/accountAdminService";
import { createInMemoryMergeTokenDao } from "../dao/mergeToken/inMemoryMergeTokenDao";
import { createPlayerGameData } from "../service/gameSession/playerGameData";
import { createMergeService, mergeSteps } from "../service/player/mergeService";
import type { HttpResult } from "../controller/web-api/shared/response";
import { createInMemoryGameTables } from "../dao/gameSession/inMemoryGameSessionDao";
import { createInMemoryPlayerDao } from "../dao/player/inMemoryPlayerDao";
import { createInMemoryPreferenceDao } from "../dao/preference/inMemoryPreferenceDao";
import { createBundledRulesRepository } from "../game-catalog";
import { logger as rootLogger, type Logger } from "../logger";
import { createInMemoryConversationMessageDao } from "../dao/conversationMessage/inMemoryConversationMessageDao";
import { createConversationService } from "../service/conversation/conversationService";
import { loadPersonality } from "../service/conversation/personality";
import { createDecisionService, type DecisionService } from "../service/decision/decisionService";
import { readApiKey } from "../service/decision/llm/apiKey";
import {
  createBedrockLlm,
  DEFAULT_AWS_REGION,
  DEFAULT_BEDROCK_MODEL,
} from "../service/decision/llm/bedrockConverse";
import { createClaudeApiLlm, DEFAULT_CLAUDE_MODEL } from "../service/decision/llm/claudeApi";
import { createClaudeCodeLlm } from "../service/decision/llm/claudeCode";
import { createFakeLlm } from "../service/decision/llm/fakeLlm";
import { createFixedResponseLlm } from "../service/decision/llm/fixedResponses";
import type { LlmClient } from "../service/decision/llm/llmClient";
import {
  createGameSessionService,
  type GameSessionService,
} from "../service/gameSession/gameSessionService";
import { createHealthService } from "../service/healthService";
import { createPlayerService } from "../service/player/playerService";
import { createMacosSpeech } from "../service/speech/macosSpeech";
import type { ProviderStatus, SpeechToText } from "../service/speech/speechToText";
import { createTranscribe } from "../service/speech/transcribe";
import { createTypedOnly } from "../service/speech/typedOnly";
import { createKokoro } from "../service/speech/kokoro";
import { createPolly } from "../service/speech/polly";
import { createRecordingTts, type TextToSpeech } from "../service/speech/textToSpeech";
import { createWhisperCpp } from "../service/speech/whisperCpp";
import { createCognitoTokenVerifier, type VerifiedAccount } from "./cognitoTokens";
import { devCaller, type DevCaller } from "./eventAdapter";
import type { LocalSettings } from "./settings";
import type { IncomingHttpHeaders } from "node:http";

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
  /** The latest turns per player, for the Voice Lab (`GET /local/decisions`). */
  turns: { recent(playerId: string, limit: number): Decision[] };
  sessions: GameSessionService;
  handlers: {
    health: Handler;
    decisions: Handler;
    game: Handler;
    players: Handler;
    admin: Handler;
  };
  status(): Promise<Record<string, CapabilityStatus>>;
  /** Drops all in-memory state and the fixed seed, for tests (POST /local/reset). */
  reset(): void;
  /** Fixes the seed of every game started from now on, or clears it (POST /local/seed). */
  setSeed(seed: string | null): void;
  /** The caller of a request under the `auth` setting (authn-authz.md section 11). */
  callerOf(headers: IncomingHttpHeaders): Promise<DevCaller>;
}

export interface ProviderOverrides {
  speechCandidates?: SpeechToText[];
  logger?: Logger;
  llm?: LlmClient;
  textToSpeech?: TextToSpeech;
  /** Replaces the Test pool's ID token verification, for tests. */
  verifyToken?: (token: string) => Promise<VerifiedAccount | null>;
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
    return createPolly({
      region: env["ALLPLAY_AWS_REGION"] ?? DEFAULT_AWS_REGION,
      voiceId: env["ALLPLAY_POLLY_VOICE"] ?? "Ruth",
    });
  return createKokoro({
    python: `${LOCAL_DIR}kokoro/venv/bin/python`,
    worker: fileURLToPath(new URL("./kokoro/worker.py", import.meta.url)),
    model: `${LOCAL_DIR}kokoro/kokoro-v1.0.onnx`,
    voices: `${LOCAL_DIR}kokoro/voices-v1.0.bin`,
    voice: env["ALLPLAY_KOKORO_VOICE"] ?? "af_heart",
  });
}

/**
 * The caller under `cognito-test`: a verified Test pool ID token in
 * `Authorization: Bearer`, else the guest's Test Identity Pool identity in
 * `x-allplay-identity-id`, else the default local guest.
 */
export function cognitoCaller(
  verifyToken: (token: string) => Promise<VerifiedAccount | null>,
): (headers: IncomingHttpHeaders) => Promise<DevCaller> {
  return async (headers) => {
    const bearer = /^Bearer (.+)$/.exec(headers.authorization ?? "")?.[1];
    if (bearer !== undefined) {
      const account = await verifyToken(bearer);
      if (account !== null)
        return { tier: account.groups.includes("ADMIN") ? "admin" : "player", id: account.sub };
    }
    const identityId = headers["x-allplay-identity-id"];
    if (typeof identityId === "string" && /^[\w-]+:[0-9a-f-]+$/.test(identityId))
      return { tier: "guest", id: identityId };
    return devCaller({});
  };
}

/** The language model for a setting (action-decision.md section 8). */
function languageModel(
  settings: LocalSettings,
  env: Readonly<Record<string, string | undefined>>,
): LlmClient {
  /* The continuous-integration preset answers "itest" commands as Test does (AD-7, LD-5). */
  if (settings.llm === "fake") return createFixedResponseLlm(createFakeLlm());
  if (settings.llm === "bedrock")
    return createBedrockLlm({
      modelId: env["ALLPLAY_BEDROCK_MODEL"] ?? DEFAULT_BEDROCK_MODEL,
      region: env["ALLPLAY_AWS_REGION"] ?? DEFAULT_AWS_REGION,
    });
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
  if (settings.speechIn === "transcribe") {
    const vocabularyName = env["ALLPLAY_TRANSCRIBE_VOCABULARY"];
    return [
      createTranscribe({
        region: env["ALLPLAY_AWS_REGION"] ?? DEFAULT_AWS_REGION,
        ...(vocabularyName === undefined ? {} : { vocabularyName }),
      }),
    ];
  }
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
  const authRegion = env["ALLPLAY_AUTH_REGION"] ?? "us-east-1";
  const authPool = env["ALLPLAY_AUTH_USER_POOL_ID"];
  const authClient = env["ALLPLAY_AUTH_CLIENT_ID"];
  const cognitoReady = authPool !== undefined && authClient !== undefined;
  const callerOf =
    settings.auth === "cognito-test" && (cognitoReady || overrides.verifyToken !== undefined)
      ? cognitoCaller(
          overrides.verifyToken ??
            createCognitoTokenVerifier({
              region: authRegion,
              userPoolId: authPool ?? "",
              userPoolClientId: authClient ?? "",
            }),
        )
      : (headers: IncomingHttpHeaders) => Promise.resolve(devCaller(headers));
  const textToSpeech = overrides.textToSpeech ?? speechOutput(settings, env);
  /* Kokoro loads its model on first use; warm it now so the first reply is quick. */
  if (textToSpeech.name === "kokoro" && (await textToSpeech.status()).available)
    void textToSpeech.synthesize("Ready.", 1).catch(() => undefined);
  const repository = createBundledRulesRepository();
  let fixedSeed: string | null = null;
  const build = () => {
    /* One in-memory store per table, shared by every service as the deployed tables are. */
    const gameTables = createInMemoryGameTables();
    const conversations = createInMemoryConversationMessageDao();
    const gameData = createPlayerGameData({ ...gameTables, conversations });
    const sessions = createGameSessionService({
      ...gameTables,
      games: (gameId, version) => repository.compiled(gameId, version),
      ...(overrides.now ? { now: overrides.now } : {}),
      newSeed: () => fixedSeed ?? (overrides.newSeed ?? randomSeed)(),
    });
    const turns = createRecentTurnLog(createLoggerTurnLog(logger.child({ bundle: "decisions" })));
    const decisions = createDecisionService({
      log: turns,
      llm,
      sessions,
      catalog: () => repository.list(),
      guidance: async (gameId, version) =>
        (await repository.get(gameId, version)).speech.deciderGuidance ?? [],
      conversation: createConversationService({
        dao: conversations,
        personality: loadPersonality({}),
        onError: (error) => {
          logger.warn("CONVERSATION_STORE_FAILED", { error: String(error) });
        },
        ...(overrides.now ? { now: overrides.now } : {}),
      }),
      ...(overrides.now ? { now: overrides.now } : {}),
    });
    const playerDao = createInMemoryPlayerDao();
    const preferenceDao = createInMemoryPreferenceDao();
    const merge = createMergeService({
      players: playerDao,
      mergeTokens: createInMemoryMergeTokenDao(),
      steps: mergeSteps(preferenceDao, gameData),
      ...(overrides.now ? { now: overrides.now } : {}),
    });
    return {
      decisions,
      turns,
      sessions,
      handlers: {
        admin: createAdminHandler({
          deployments: createDeploymentService(createInMemoryDeploymentPipeline(overrides.now)),
          accounts: createAccountAdminService(playerDao, merge),
          metrics: createMetricsAdminService({
            rollups: createInMemoryMetricRollupDao(),
            turns: turns.reader(),
          }),
          logger: logger.child({ bundle: "admin" }),
        }),
        players: createPlayersHandler({
          players: createPlayerService({
            players: playerDao,
            preferences: preferenceDao,
            gameData,
            ...(overrides.now ? { now: overrides.now } : {}),
          }),
          merge,
          logger: logger.child({ bundle: "players" }),
        }),
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
    get turns() {
      return built.turns;
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
      auth:
        settings.auth === "mock"
          ? {
              setting: "mock",
              provider: "development header",
              available: true,
              detail: "Guest, player or admin from x-allplay-dev-caller.",
            }
          : {
              setting: "cognito-test",
              provider: "cognito",
              available: cognitoReady || overrides.verifyToken !== undefined,
              detail: cognitoReady
                ? `Test User Pool ${authPool}.`
                : "Set ALLPLAY_AUTH_USER_POOL_ID and ALLPLAY_AUTH_CLIENT_ID (npm run dev:aws-auth does).",
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
    callerOf,
  };
  return providers;
}

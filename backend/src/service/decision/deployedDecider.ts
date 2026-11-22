import { createDynamoPreferenceDao } from "../../dao/preference/dynamoPreferenceDao";
import { createDynamoRateLimitCounterDao } from "../../dao/rateLimitCounter/dynamoRateLimitCounterDao";
import { createBundledRulesRepository } from "../../game-catalog";
import type { Logger } from "../../logger";
import { DEFAULT_APP_PREFERENCES } from "../../models/api";
import { createDeployedGameSessionService } from "../gameSession/gameSessionService";
import { createDecisionService, type DecisionService } from "./decisionService";
import { createBedrockLlm, DEFAULT_AWS_REGION, DEFAULT_BEDROCK_MODEL } from "./llm/bedrockConverse";
import { createFixedResponseLlm } from "./llm/fixedResponses";
import type { LlmClient } from "./llm/llmClient";
import { createRateLimiter } from "./rateLimiter";
import { createLoggerTurnLog } from "./turnLog";

/**
 * The stage's model: Bedrock with the configured model (action-decision.md
 * section 8), behind fixed test answers when DECIDER_FIXED_RESPONSES is
 * ENABLED, which CDK sets in Test only. Throttling is logged for its alarm.
 */
export function deployedLanguageModel(
  env: Readonly<Record<string, string | undefined>>,
  logger: Logger,
): LlmClient {
  const bedrock = createBedrockLlm({
    modelId: env["DECIDER_MODEL_ID"] ?? DEFAULT_BEDROCK_MODEL,
    region: env["AWS_REGION"] ?? DEFAULT_AWS_REGION,
    onThrottled: () => {
      logger.warn("BEDROCK_THROTTLED");
    },
  });
  return env["DECIDER_FIXED_RESPONSES"] === "ENABLED" ? createFixedResponseLlm(bedrock) : bedrock;
}

/** The action decider over the deployed tables: sessions, preferences and rate limits. */
export function createDeployedDecisionService(
  logger: Logger,
  env: Readonly<Record<string, string | undefined>> = process.env,
): DecisionService {
  const repository = createBundledRulesRepository();
  const preferences = createDynamoPreferenceDao(env["PREFERENCES_TABLE"] ?? "");
  return createDecisionService({
    log: createLoggerTurnLog(logger),
    llm: deployedLanguageModel(env, logger),
    sessions: createDeployedGameSessionService(repository, env),
    catalog: () => repository.list(),
    guidance: async (gameId, version) =>
      (await repository.get(gameId, version)).speech.deciderGuidance ?? [],
    preferences: async (playerId) => {
      const app = (await preferences.list(playerId)).find((item) => item.scope === "APP");
      return { autoConfirm: app?.autoConfirm ?? DEFAULT_APP_PREFERENCES.autoConfirm };
    },
    rateLimiter: createRateLimiter(createDynamoRateLimitCounterDao(env["RATE_LIMITS_TABLE"] ?? "")),
  });
}

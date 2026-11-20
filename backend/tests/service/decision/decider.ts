import { createInMemoryDecisionDao } from "../../../src/dao/decision/inMemoryDecisionDao";
import { createInMemoryGameSessionDao } from "../../../src/dao/gameSession/inMemoryGameSessionDao";
import { createInMemorySeatAssignmentDao } from "../../../src/dao/seatAssignment/inMemorySeatAssignmentDao";
import { createBundledRulesRepository } from "../../../src/game-catalog";
import { DecisionRequestSchema } from "../../../src/models/api";
import type { z } from "zod";
import type { DecisionDao } from "../../../src/dao/decision/decisionDao";
import {
  createDecisionService,
  type DecisionService,
  type DecisionServiceDeps,
} from "../../../src/service/decision/decisionService";
import { createFakeLlm } from "../../../src/service/decision/llm/fakeLlm";
import type { LlmRequest } from "../../../src/service/decision/llm/llmClient";
import {
  createGameSessionService,
  type GameSessionService,
} from "../../../src/service/gameSession/gameSessionService";

export const PLAYER = "GUEST#p1";
export const SEED = "00000000000000000000000000000001";
export const FIRST_MOVE = "MOVE_UNIT|from=tableau.1|depth=1|to=tableau.6";

/** The transcript inside a prompt's <transcript> tags. */
export const heard = (request: LlmRequest): string =>
  /<transcript>(.*)<\/transcript>/.exec(request.user)?.[1] ?? "";

/** The candidate number of an action id in a game selection prompt. */
export function numberOf(
  request: LlmRequest,
  actionId: string,
  texts: Map<string, string>,
): number {
  const text = texts.get(actionId) ?? actionId;
  const line = request.user.split("\n").find((l) => l.endsWith(`| ${text}`));
  return Number(line?.split(" | ")[0] ?? 0);
}

export type Answers = Record<string, (request: LlmRequest) => unknown>;

/** A decider over the real session service and Spider rules, with a scripted model keyed by tool name. */
export function setupDecider(
  answers: Answers,
  extra: Partial<DecisionServiceDeps> = {},
): {
  decider: DecisionService;
  sessions: GameSessionService;
  llm: ReturnType<typeof createFakeLlm>;
  dao: DecisionDao;
} {
  const repository = createBundledRulesRepository();
  const sessions = createGameSessionService({
    dao: createInMemoryGameSessionDao(),
    seats: createInMemorySeatAssignmentDao(),
    games: (gameId, version) => repository.compiled(gameId, version),
    newSeed: () => SEED,
  });
  const llm = createFakeLlm((request) => answers[request.tool.name]?.(request), "fake-model");
  const dao = createInMemoryDecisionDao();
  let tick = 0;
  const decider = createDecisionService({
    dao,
    llm,
    sessions,
    catalog: () => repository.list(),
    guidance: async (gameId, version) =>
      (await repository.get(gameId, version)).speech.deciderGuidance ?? [],
    now: () => new Date(Date.UTC(2026, 10, 20, 12, 0, tick++)),
    ...extra,
  });
  return { decider, sessions, llm, dao };
}

export const ask = (
  transcript: string,
  context: Partial<{
    screen: string;
    sessionId: string | null;
    expectedVersion: number | null;
    pendingDecisionId: string | null;
  }> = {},
): z.output<typeof DecisionRequestSchema> =>
  DecisionRequestSchema.parse({
    transcript,
    transcriptSource: "TYPED",
    context: {
      screen: "GAME",
      sessionId: null,
      expectedVersion: null,
      pendingDecisionId: null,
      ...context,
    },
  });

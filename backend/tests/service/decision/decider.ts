import { createInMemoryGameTables } from "../../../src/dao/gameSession/inMemoryGameSessionDao";
import { createBundledRulesRepository } from "../../../src/game-catalog";
import {
  DecisionRequestSchema,
  type DecisionResponse,
  type PendingPrompt,
} from "../../../src/models/api";
import type { Decision } from "../../../src/models/decision";
import type { z } from "zod";
import {
  createDecisionService,
  type DecisionService,
  type DecisionServiceDeps,
} from "../../../src/service/decision/decisionService";
import { createFakeLlm } from "../../../src/service/decision/llm/fakeLlm";
import type { LlmRequest } from "../../../src/service/decision/llm/llmClient";
import type { TurnLog, TurnResolved } from "../../../src/service/decision/turnLog";
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
  /** The TURN_DECIDED event of a decision. */
  turn: (decisionId: string) => Decision | undefined;
  /** The last TURN_RESOLVED event of a decision. */
  settled: (decisionId: string) => TurnResolved | undefined;
  log: { decided: Decision[]; resolved: TurnResolved[] };
} {
  const repository = createBundledRulesRepository();
  const sessions = createGameSessionService({
    ...createInMemoryGameTables(),
    games: (gameId, version) => repository.compiled(gameId, version),
    newSeed: () => SEED,
  });
  const llm = createFakeLlm((request) => answers[request.tool.name]?.(request), "fake-model");
  const log = { decided: [] as Decision[], resolved: [] as TurnResolved[] };
  const turns: TurnLog = {
    decided: (turn) => log.decided.push(turn),
    resolved: (event) => log.resolved.push(event),
  };
  let tick = 0;
  const decider = createDecisionService({
    log: turns,
    llm,
    sessions,
    catalog: () => repository.list(),
    guidance: async (gameId, version) =>
      (await repository.get(gameId, version)).speech.deciderGuidance ?? [],
    now: () => new Date(Date.UTC(2026, 10, 20, 12, 0, tick++)),
    ...extra,
  });
  return {
    decider,
    sessions,
    llm,
    log,
    turn: (id) => log.decided.find((turn) => turn.decisionId === id),
    settled: (id) => log.resolved.filter((event) => event.decisionId === id).at(-1),
  };
}

/** The prompt a client sends back while a decision waits for an answer (action-decision.md section 4.1). */
export function promptFor(response: DecisionResponse): PendingPrompt {
  if (response.choices !== null)
    return {
      decisionId: response.decisionId,
      kind: "CHOICES",
      actionIds: response.choices.map((choice) => choice.actionId),
      appAction: null,
    };
  return {
    decisionId: response.decisionId,
    kind: "CONFIRMATION",
    actionIds: response.proposal === null ? [] : [response.proposal.actionId],
    appAction: response.proposal === null ? response.appAction : null,
  };
}

export const ask = (
  transcript: string,
  context: Partial<{
    screen: string;
    sessionId: string | null;
    expectedVersion: number | null;
    pendingPrompt: PendingPrompt | null;
  }> = {},
): z.output<typeof DecisionRequestSchema> =>
  DecisionRequestSchema.parse({
    transcript,
    transcriptSource: "TYPED",
    context: {
      screen: "GAME",
      sessionId: null,
      expectedVersion: null,
      pendingPrompt: null,
      ...context,
    },
  });

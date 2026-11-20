import type { DecisionDao } from "../../dao/decision/decisionDao";
import type { DecisionRequestSchema, DecisionResponse } from "../../models/api";
import type { Decision } from "../../models/decision";
import { newUlid } from "../gameSession/ulid";
import type { z } from "zod";

type ParsedDecisionRequest = z.output<typeof DecisionRequestSchema>;

/** Decisions expire 30 days after creation (data-model.md section 9). */
const TTL_SECONDS = 30 * 24 * 60 * 60;

export interface DecisionServiceDeps {
  dao: DecisionDao;
  now?: () => Date;
  newId?: () => string;
}

export interface DecisionService {
  decide(playerId: string, request: ParsedDecisionRequest): Promise<DecisionResponse>;
  recent(playerId: string, limit: number): Promise<Decision[]>;
}

/**
 * The action decider (action-decision.md section 2). This is the intake of
 * AD-12: it records every turn as a Decision and answers UNRECOGNIZED with
 * what it heard. The classification and selection layers (AD-2 to AD-5)
 * replace that answer without changing the intake.
 */
export function createDecisionService(deps: DecisionServiceDeps): DecisionService {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => newUlid(now().getTime()));
  return {
    decide: async (playerId, request) => {
      const started = now();
      const transcript = request.transcript.trim();
      const displayText = `I heard "${transcript}". Understanding commands is not wired up yet.`;
      const decision: Decision = {
        decisionId: newId(),
        playerId,
        ...(request.context.sessionId === null ? {} : { sessionId: request.context.sessionId }),
        ...(request.context.expectedVersion === null
          ? {}
          : { sessionVersion: request.context.expectedVersion }),
        transcriptSource: request.transcriptSource,
        transcript,
        alternatives: request.alternatives,
        uiContext: {
          screen: request.context.screen,
          pendingPrompt: request.context.pendingDecisionId,
        },
        outcome: "UNRECOGNIZED",
        failureClass: "HARD",
        serverLatencyMs: Math.max(0, now().getTime() - started.getTime()),
        ttl: Math.floor(started.getTime() / 1000) + TTL_SECONDS,
        entityVersion: 1,
        createdAt: started.toISOString(),
        updatedAt: started.toISOString(),
      };
      await deps.dao.create(decision);
      return {
        decisionId: decision.decisionId,
        outcome: "UNRECOGNIZED",
        displayText,
        speech: `I heard ${transcript}.`,
        proposal: null,
        choices: null,
        appAction: null,
        session: null,
      };
    },
    recent: (playerId, limit) => deps.dao.listByPlayer(playerId, limit),
  };
}

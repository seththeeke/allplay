import type { DecisionResponse, PendingPrompt, ResolutionRequest } from "../models/api";

/**
 * The prompt on screen, sent back with the next voice request: the server
 * keeps no turn, so this is how it knows what "yes" or "two" answers
 * (action-decision.md section 4.1). Null when nothing waits for an answer.
 */
export function pendingPromptOf(decision: DecisionResponse | null): PendingPrompt | null {
  if (decision === null) return null;
  if (decision.choices !== null)
    return {
      decisionId: decision.decisionId,
      kind: "CHOICES",
      actionIds: decision.choices.map((choice) => choice.actionId),
      appAction: null,
    };
  if (decision.proposal !== null)
    return {
      decisionId: decision.decisionId,
      kind: "CONFIRMATION",
      actionIds: [decision.proposal.actionId],
      appAction: null,
    };
  return decision.appAction === null
    ? null
    : {
        decisionId: decision.decisionId,
        kind: "CONFIRMATION",
        actionIds: [],
        appAction: decision.appAction,
      };
}

/** A resolution with the action it applies, for the stateless resolution route (action-decision.md section 4.2). */
export function resolutionFor(
  decision: DecisionResponse,
  resolution: ResolutionRequest["resolution"],
  game: { sessionId: string; version: number } | null,
  clientLatencyMs: number,
  optionNumber: number | null = null,
): ResolutionRequest {
  const actionId =
    resolution === "CHOSE_OPTION"
      ? (decision.choices?.find((choice) => choice.number === optionNumber)?.actionId ?? null)
      : resolution === "CONFIRMED"
        ? (decision.proposal?.actionId ?? null)
        : null;
  return {
    resolution,
    sessionId: game?.sessionId ?? null,
    actionId,
    expectedVersion: game?.version ?? null,
    clientLatencyMs,
  };
}

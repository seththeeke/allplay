import { holds } from "../primitives/expressions";
import type { GameState, LegalAction } from "../types";
import { replay, simulate } from "./apply";
import { evalContext, type Engine } from "./engine";
import { listLegalActions, parseActionId } from "./enumerate";

/** Zones and face states only: what a player sees, ignoring vars and history. */
function tableKey(state: GameState): string {
  return JSON.stringify(
    Object.entries(state.zones).map(([zoneId, pile]) => [
      zoneId,
      pile.map((id) => `${id}${state.cards[id]?.faceUp === true ? "+" : "-"}`),
    ]),
  );
}

/**
 * getHint (game-engine.md section 4.11): the legal action with the highest
 * summed weight; ties go to the earliest in list order. `reversesLastAction`
 * holds when the action returns the table to its state before the last action.
 */
export function getHint(engine: Engine, state: GameState): LegalAction | null {
  const actions = listLegalActions(engine, state);
  let previous: string | null | undefined;
  const previousKey = (): string | null => {
    if (previous === undefined) {
      previous =
        state.history.length === 0
          ? null
          : tableKey(replay(engine, state, state.history.slice(0, -1)));
    }
    return previous;
  };
  let best: LegalAction | null = null;
  let bestWeight = Number.NEGATIVE_INFINITY;
  for (const action of actions) {
    const { template, binding } = parseActionId(engine, action.actionId) as NonNullable<
      ReturnType<typeof parseActionId>
    >;
    const ctx = {
      ...evalContext(engine, state, binding),
      reversesLastAction: () =>
        previousKey() === tableKey(simulate(engine, state, template, binding)),
    };
    const weight = engine.rules.hints.weights
      .filter((entry) => entry.action === undefined || entry.action === action.templateId)
      .filter((entry) => holds(entry.when, ctx))
      .reduce((sum, entry) => sum + entry.weight, 0);
    if (weight > bestWeight) {
      best = action;
      bestWeight = weight;
    }
  }
  return best;
}

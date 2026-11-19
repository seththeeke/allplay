import { EngineInvariantError } from "../errors";
import type { EvalContext } from "../primitives/expressions";
import type { GameLayout } from "../primitives/layout";
import type { ActionTemplate, RulesDocument } from "../rules/schema";
import type { GameEvent, GameState } from "../types";
import type { MutationContext } from "../primitives/effects";

/** A compiled rules document: the parsed rules plus derived lookups (game-engine.md section 2). */
export interface Engine {
  rules: RulesDocument;
  layout: GameLayout;
  templates: ReadonlyMap<string, ActionTemplate>;
}

/** Vars every game has (game-engine.md section 4.2). */
export const BUILT_IN_VARS = ["score", "moveCount", "undoCount"] as const;

/** Trigger passes allowed before rules are judged never to settle (section 4.8). */
export const TRIGGER_PASS_LIMIT = 100;

export function evalContext(
  engine: Engine,
  state: GameState,
  params: Readonly<Record<string, string | number>> = {},
): EvalContext {
  return { state, layout: engine.layout, params, refs: {} };
}

export function mutationContext(
  engine: Engine,
  state: GameState,
  events: GameEvent[],
): MutationContext {
  return { ...evalContext(engine, state), events };
}

/** A deep copy; the engine never mutates a state it was given. */
export function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

/** Every card sits in exactly one zone and none is lost or invented (section 7.3). */
export function checkInvariants(state: GameState): void {
  const seen = new Set<string>();
  for (const pile of Object.values(state.zones)) {
    for (const cardId of pile) {
      if (seen.has(cardId) || state.cards[cardId] === undefined) {
        throw new EngineInvariantError(`Card ${cardId} is duplicated or unknown`);
      }
      seen.add(cardId);
    }
  }
  if (seen.size !== Object.keys(state.cards).length) {
    throw new EngineInvariantError("A card is missing from every zone");
  }
}

export function templateOf(engine: Engine, templateId: string): ActionTemplate | undefined {
  return engine.templates.get(templateId);
}

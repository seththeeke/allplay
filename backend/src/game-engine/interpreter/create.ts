import { InvalidGameInputError } from "../errors";
import { evaluate } from "../primitives/expressions";
import { runSetupStep } from "../primitives/setup";
import { createRandom } from "../random/xoshiro";
import type { RulesDocument } from "../rules/schema";
import type { CreateGameInput, GameState, OptionValue } from "../types";
import {
  BUILT_IN_VARS,
  checkInvariants,
  evalContext,
  mutationContext,
  type Engine,
} from "./engine";
import { evaluateEndConditions, settleTriggers } from "./triggers";

/**
 * Fills defaults and rejects unknown names or values. A value may arrive as
 * its string form (for example "4" for suits 4) and is stored as declared.
 */
export function resolveOptions(
  rules: RulesDocument,
  input: Readonly<Record<string, unknown>>,
): Record<string, OptionValue> {
  const unknown = Object.keys(input).filter((name) => !(name in rules.options));
  if (unknown.length > 0) throw new InvalidGameInputError(`Unknown options: ${unknown.join(", ")}`);
  return Object.fromEntries(
    Object.entries(rules.options).map(([name, option]) => {
      const given = input[name];
      if (given === undefined) return [name, option.default];
      const match = option.values.find(
        (value) => value === given || String(value) === JSON.stringify(given).replace(/^"|"$/g, ""),
      );
      if (match === undefined) throw new InvalidGameInputError(`Invalid value for option ${name}`);
      return [name, match];
    }),
  );
}

/** createGame (game-engine.md section 7.1): options, cards, setup, triggers, end conditions; version 0. */
export function createGame(engine: Engine, input: CreateGameInput): GameState {
  const { rules } = engine;
  if (input.seats.length < rules.players.min || input.seats.length > rules.players.max) {
    throw new InvalidGameInputError(
      `This game takes ${String(rules.players.min)} to ${String(rules.players.max)} seats`,
    );
  }
  const random = createRandom(input.seed);
  const state: GameState = {
    engineSchemaVersion: 1,
    gameId: rules.gameId,
    rulesVersion: rules.version,
    options: resolveOptions(rules, input.options),
    seed: input.seed,
    seats: input.seats.map((seatId) => ({ seatId })),
    cards: {},
    zones: Object.fromEntries(engine.layout.order.map((zoneId) => [zoneId, []])),
    vars: Object.fromEntries(BUILT_IN_VARS.map((name) => [name, 0])),
    history: [],
    scoreCarry: 0,
    status: "IN_PROGRESS",
    version: 0,
  };
  const ctx = evalContext(engine, state);
  for (const [name, spec] of Object.entries(rules.vars)) {
    const value = evaluate(spec.initial, ctx);
    state.vars[name] = typeof value === "number" ? value : 0;
  }
  for (const step of rules.setup) runSetupStep(step, rules, random, ctx);
  const mutation = mutationContext(engine, state, []);
  settleTriggers(engine, mutation);
  evaluateEndConditions(engine, mutation);
  checkInvariants(state);
  return state;
}

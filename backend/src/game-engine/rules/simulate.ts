import { replay, statusOf, undo, applyAction } from "../interpreter/apply";
import { buildLayout } from "../primitives/layout";
import { cloneState, type Engine } from "../interpreter/engine";
import { legalBindings, actionIdOf } from "../interpreter/enumerate";
import { createGame } from "../interpreter/create";
import { createRandom, type Random } from "../random/xoshiro";
import type { GameState, OptionValue } from "../types";
import type { RulesDocument } from "./schema";

/** Stage 3 of rules validation (game-engine.md section 13). Defaults are the spec's numbers. */
export interface SimulationOptions {
  /** Games per option combination. */
  seedsPerCombination?: number;
  /** Random legal actions per game. */
  actionsPerGame?: number;
  /** One step in this many is an undo, when undo is available. */
  undoOneIn?: number;
  /** Seed of the generator that picks game seeds, actions and undos, so a run is reproducible. */
  masterSeed?: string;
}

export interface SimulationReport {
  games: number;
  actions: number;
  undos: number;
  issues: string[];
}

const DEFAULTS: Required<SimulationOptions> = {
  seedsPerCombination: 50,
  actionsPerGame: 500,
  undoOneIn: 20,
  masterSeed: "5eed0000000000000000000000000001",
};

/** Every combination of option values, in declaration order. */
export function optionCombinations(rules: RulesDocument): Record<string, OptionValue>[] {
  return Object.entries(rules.options).reduce<Record<string, OptionValue>[]>(
    (combos, [name, option]) =>
      combos.flatMap((combo) => option.values.map((value) => ({ ...combo, [name]: value }))),
    [{}],
  );
}

function seedFrom(random: Random): string {
  return Array.from({ length: 4 }, () => random.nextUint32().toString(16).padStart(8, "0")).join(
    "",
  );
}

/** Every action legal in a state, as ids, without building descriptors or text. */
function legalIds(engine: Engine, state: GameState): string[] {
  return engine.rules.actions.flatMap((template) =>
    [...legalBindings(engine, template, state)].map((binding) => actionIdOf(template, binding)),
  );
}

/** Replaying the history from the seed must reproduce the table, the status and every var but the undo carry. */
export function replayMatches(engine: Engine, state: GameState): boolean {
  const rebuilt = replay(engine, state, state.history);
  const expected = cloneState(state);
  rebuilt.vars["score"] = (rebuilt.vars["score"] as number) + state.scoreCarry;
  rebuilt.vars["undoCount"] = state.vars["undoCount"] as number;
  return (
    JSON.stringify([rebuilt.zones, rebuilt.cards, rebuilt.vars, rebuilt.status]) ===
    JSON.stringify([expected.zones, expected.cards, expected.vars, expected.status])
  );
}

function playOne(
  engine: Engine,
  options: Record<string, OptionValue>,
  seed: string,
  settings: Required<SimulationOptions>,
  random: Random,
  report: SimulationReport,
): void {
  let state = createGame(engine, { options, seed, seats: ["S1"] });
  for (let step = 0; step < settings.actionsPerGame && state.status === "IN_PROGRESS"; step += 1) {
    if (statusOf(engine, state).canUndo && random.nextInt(settings.undoOneIn) === 0) {
      state = undo(engine, state, "S1").state;
      report.undos += 1;
      continue;
    }
    const ids = legalIds(engine, state);
    if (ids.length === 0) break;
    state = applyAction(engine, state, "S1", ids[random.nextInt(ids.length)] as string).state;
    report.actions += 1;
  }
  if (!replayMatches(engine, state))
    report.issues.push("replay from the seed does not reproduce the final state");
}

/**
 * Plays random legal actions with random undos for every option combination.
 * Any thrown error (an invariant, a trigger that never settles, an illegal
 * replay) or a replay mismatch becomes an issue naming the options and seed.
 */
export function simulateRules(
  rules: RulesDocument,
  options: SimulationOptions = {},
): SimulationReport {
  const settings = { ...DEFAULTS, ...options };
  const engine: Engine = {
    rules,
    layout: buildLayout(rules.zones),
    templates: new Map(rules.actions.map((action) => [action.id, action])),
  };
  const random = createRandom(settings.masterSeed);
  const report: SimulationReport = { games: 0, actions: 0, undos: 0, issues: [] };
  for (const combo of optionCombinations(rules)) {
    for (let i = 0; i < settings.seedsPerCombination; i += 1) {
      const seed = seedFrom(random);
      const before = report.issues.length;
      try {
        playOne(engine, combo, seed, settings, random, report);
      } catch (error) {
        report.issues.push(
          error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        );
      }
      for (let j = before; j < report.issues.length; j += 1) {
        report.issues[j] =
          `simulation ${JSON.stringify(combo)} seed ${seed}: ${report.issues[j] as string}`;
      }
      report.games += 1;
    }
  }
  return report;
}

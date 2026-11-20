import { describe, expect, it } from "vitest";
import { compileRules, validateRules } from "../../src/game-engine";
import { buildLayout } from "../../src/game-engine/primitives/layout";
import { RulesDocumentSchema } from "../../src/game-engine/rules/schema";
import {
  optionCombinations,
  replayMatches,
  simulateRules,
} from "../../src/game-engine/rules/simulate";
import { createBundledRulesRepository } from "../../src/game-catalog";
import { toyRules } from "./toyRules";

const toy = RulesDocumentSchema.parse(toyRules());

describe("rules simulation", () => {
  it("lists every option combination", () => {
    expect(optionCombinations(toy)).toEqual([
      { mode: "EASY", size: 1 },
      { mode: "EASY", size: 2 },
      { mode: "HARD", size: 1 },
      { mode: "HARD", size: 2 },
    ]);
  });

  it("plays the toy game with undos and finds no issues, reproducibly", () => {
    const report = simulateRules(toy, { seedsPerCombination: 5, actionsPerGame: 60, undoOneIn: 4 });
    expect(report.issues).toEqual([]);
    expect(report.games).toBe(20);
    expect(report.undos).toBeGreaterThan(0);
    expect(
      simulateRules(toy, { seedsPerCombination: 5, actionsPerGame: 60, undoOneIn: 4 }),
    ).toEqual(report);
  });

  it("reports a trigger that never settles mid-game, naming the options and seed", () => {
    const rules = toyRules();
    (rules["triggers"] as unknown[]).push({
      id: "STUCK",
      when: { gte: [{ var: "moveCount" }, 1] },
      effects: [{ addVar: { name: "peeks", by: 0 } }],
    });
    const result = validateRules(rules, {
      simulate: { seedsPerCombination: 1, actionsPerGame: 20 },
    });
    expect(result.valid).toBe(false);
    expect(result.valid ? [] : result.issues[0]).toMatch(
      /^simulation \{"mode":"EASY","size":1\} seed [0-9a-f]{32}: EngineInvariantError: Triggers did not settle/,
    );
  });

  it("detects a state that its history does not reproduce", () => {
    const game = compileRules(toyRules());
    const state = game.applyAction(
      game.createGame({ options: {}, seed: "00000000000000000000000000000009", seats: ["S1"] }),
      "S1",
      "DRAW",
    ).state;
    const engine = {
      rules: toy,
      layout: buildLayout(toy.zones),
      templates: new Map(toy.actions.map((a) => [a.id, a])),
    };
    expect(replayMatches(engine, state)).toBe(true);
    expect(replayMatches(engine, { ...state, vars: { ...state.vars, banked: 9 } })).toBe(false);
  });

  it("passes a short Spider simulation for every option combination", () => {
    const rules = createBundledRulesRepository();
    return rules.latest("spider-solitaire").then((doc) => {
      const result = validateRules(doc, {
        simulate: { seedsPerCombination: 1, actionsPerGame: 120 },
      });
      expect(result.valid).toBe(true);
    });
  });
});

import { describe, expect, it } from "vitest";
import { compileRules, type GameState } from "../../src/game-engine";
import { runEffect, type MutationContext } from "../../src/game-engine/primitives/effects";
import { buildLayout } from "../../src/game-engine/primitives/layout";
import { RulesDocumentSchema } from "../../src/game-engine/rules/schema";
import { arrange } from "./arrange";
import { toyRules } from "./toyRules";

const rules = RulesDocumentSchema.parse(toyRules());
const layout = buildLayout(rules.zones);
const SEED = "00000000000000000000000000000001";
const base = compileRules(toyRules()).createGame({ options: {}, seed: SEED, seats: ["S1"] });

function ctx(state: GameState): MutationContext {
  return { state: structuredClone(state), layout, params: {}, refs: {}, events: [] };
}

describe("effects", () => {
  const table = arrange(
    base,
    {
      "pile.1": [[2, "SPADES", true]],
      "done.1": [[1, "SPADES", true]],
      "done.2": [[1, "HEARTS", true]],
    },
    "deck.1",
  );

  it("refuses to move a missing, zero or excessive number of cards", () => {
    for (const count of [{ rank: { card: { zone: "pile.3", fromTop: 1 } } }, 0, 5]) {
      expect(() => {
        runEffect({ moveCards: { from: "pile.1", count, to: "pile.2" } }, ctx(table));
      }).toThrow(/Cannot move/);
    }
  });

  it("refuses to flip an empty zone or bank with no empty target", () => {
    expect(() => {
      runEffect({ flipTop: { zone: "pile.3", faceUp: true } }, ctx(table));
    }).toThrow(/empty pile.3/);
    expect(() => {
      runEffect({ moveToFirstEmpty: { from: "pile.1", count: 1, type: "done" } }, ctx(table));
    }).toThrow(/No empty done/);
  });

  it("treats a missing var delta as zero and records nothing", () => {
    const c = ctx(table);
    runEffect(
      { addVar: { name: "banked", by: { rank: { card: { zone: "pile.3", fromTop: 1 } } } } },
      c,
    );
    expect(c.state.vars["banked"]).toBe(0);
    expect(c.events).toEqual([]);
  });
});

describe("setup and vars", () => {
  it("stores non-numeric var values as zero and deals shorter count lists to the first zones only", () => {
    const doc = toyRules();
    (doc["vars"] as Record<string, unknown>)["bonus"] = { initial: "text", label: "bonus" };
    (doc["setup"] as unknown[]).splice(
      4,
      2,
      { dealRows: { from: "deck.1", type: "pile", counts: [1], faceUp: false } },
      { setVar: { name: "peeks", value: "text" } },
    );
    const state = compileRules(doc).createGame({ options: {}, seed: SEED, seats: ["S1"] });
    expect(state.vars).toMatchObject({ bonus: 0, peeks: 0 });
    expect([1, 2, 3].map((i) => state.zones[`pile.${String(i)}`]?.length)).toEqual([1, 0, 0]);
  });

  it("offers no values for an integer domain without bounds", () => {
    const doc = toyRules();
    const shift = (doc["actions"] as { params: { domain: unknown }[] }[])[0];
    if (shift?.params[1] === undefined) throw new Error("fixture changed");
    shift.params[1].domain = {
      int: { min: 1, max: { rank: { card: { zone: "deck.1", fromTop: 99 } } } },
    };
    const game = compileRules(doc);
    const state = game.createGame({ options: {}, seed: SEED, seats: ["S1"] });
    expect(game.listLegalActions(state, "S1").some((action) => action.templateId === "SHIFT")).toBe(
      false,
    );
  });
});

import { describe, expect, it } from "vitest";
import { compileRules, type GameState } from "../../src/game-engine";
import {
  evaluate,
  holds,
  zoneOf,
  type EvalContext,
} from "../../src/game-engine/primitives/expressions";
import { buildLayout } from "../../src/game-engine/primitives/layout";
import { RulesDocumentSchema, type Expr } from "../../src/game-engine/rules/schema";
import { arrange } from "./arrange";
import { toyRules } from "./toyRules";

const rules = RulesDocumentSchema.parse(toyRules());
const layout = buildLayout(rules.zones);
const created = compileRules(toyRules()).createGame({
  options: {},
  seed: "00000000000000000000000000000001",
  seats: ["S1"],
});
/* pile.1 bottom to top: 5S down, 4H up, 3S up, 2S up; pile.2: 7H up; pile.3 empty. */
const state: GameState = arrange(
  created,
  {
    "pile.1": [
      [5, "SPADES", false],
      [4, "HEARTS", true],
      [3, "SPADES", true],
      [2, "SPADES", true],
    ],
    "pile.2": [[5, "HEARTS", true]],
  },
  "deck.1",
);

function ctx(extra: Partial<EvalContext> = {}): EvalContext {
  return { state, layout, params: { from: "pile.1", n: 2 }, refs: { z: "pile.2" }, ...extra };
}
const run = (expr: Expr, extra?: Partial<EvalContext>) => evaluate(expr, ctx(extra));
const top = (n: Expr = 1) => ({ card: { zone: "pile.1", fromTop: n } });

describe("expressions", () => {
  it("evaluates literals, params, options, vars, refs and zones", () => {
    expect(run(7)).toBe(7);
    expect(run("SPADES")).toBe("SPADES");
    expect(run(null)).toBeNull();
    expect(run({ param: "n" })).toBe(2);
    expect(run({ option: "mode" })).toBe("EASY");
    expect(run({ option: "missing" })).toBeNull();
    expect(run({ var: "bonus" })).toBe(11);
    expect(run({ var: "missing" })).toBeNull();
    expect(run({ ref: "z" })).toBe("pile.2");
    expect(run({ zone: "pile.3" })).toBe("pile.3");
    expect(run({ count: "pile.1" })).toBe(4);
  });

  it("reads cards and their properties, with null past the ends", () => {
    expect(run({ rank: top() })).toBe(2);
    expect(run({ suit: top(3) })).toBe("HEARTS");
    expect(run({ color: top(3) })).toBe("RED");
    expect(run({ color: top() })).toBe("BLACK");
    expect(run({ faceUp: top(4) })).toBe(false);
    expect(run(top(5))).toBeNull();
    expect(run(top(0))).toBeNull();
    expect(run(top({ var: "missing" }))).toBeNull();
    expect(run({ rank: top(9) })).toBeNull();
    expect(run({ cards: { zone: "pile.1", fromTop: 2 } })).toHaveLength(2);
    expect(run({ cards: { zone: "pile.1", fromTop: 9 } })).toHaveLength(4);
    expect(run({ cards: { zone: "pile.1", fromTop: null } })).toEqual([]);
    const ghost = { ...state, zones: { ...state.zones, "pile.3": ["nope"] } };
    expect(() =>
      evaluate({ rank: { card: { zone: "pile.3", fromTop: 1 } } }, ctx({ state: ghost })),
    ).toThrow(/Unknown card/);
  });

  it("measures runs by suit rule and face state", () => {
    const spec = (suit: string, faceUpOnly: boolean, rankStep = -1) => ({
      runLength: { zone: "pile.1", rankStep, suit, faceUpOnly },
    });
    expect(run(spec("SAME", true))).toBe(2);
    expect(run(spec("ANY", true))).toBe(3);
    expect(run(spec("ANY", false))).toBe(4);
    expect(run(spec("ALTERNATE_COLOR", true))).toBe(1);
    expect(run(spec("ANY", true, 1))).toBe(1);
    expect(run({ runLength: { zone: "pile.3" } })).toBe(0);
    expect(run({ runLength: { zone: "pile.1" } })).toBe(4);
    expect(run({ runLength: { zone: "pile.1", rankStep: "down" } })).toBe(4);
    expect(
      run({ isSequence: { cards: { cards: { zone: "pile.1", fromTop: 2 } }, rankStep: "down" } }),
    ).toBe(true);
    expect(run({ rank: { card: { zone: "pile.1" } } })).toBe(2);
  });

  it("checks sequences and face state of card lists", () => {
    const cards = (n: number) => ({ cards: { zone: "pile.1", fromTop: n } });
    expect(run({ isSequence: { cards: cards(2), rankStep: -1, suit: "SAME" } })).toBe(true);
    expect(run({ isSequence: { cards: cards(3), rankStep: -1, suit: "SAME" } })).toBe(false);
    expect(run({ isSequence: { cards: cards(3), rankStep: -1, suit: "ANY" } })).toBe(true);
    expect(run({ isSequence: { cards: cards(3) } })).toBe(true);
    expect(run({ isSequence: { cards: top() } })).toBe(true);
    expect(run({ isSequence: { cards: null } })).toBe(true);
    expect(run({ allFaceUp: cards(3) })).toBe(true);
    expect(run({ allFaceUp: cards(4) })).toBe(false);
    expect(run({ allFaceUp: top() })).toBe(true);
  });

  it("does arithmetic and comparisons, treating null as no value", () => {
    expect(run({ add: [2, 3] })).toBe(5);
    expect(run({ sub: [2, 3] })).toBe(-1);
    expect(run({ min: [2, 3] })).toBe(2);
    expect(run({ max: [2, 3] })).toBe(3);
    expect(run({ div: [7, 2] })).toBe(3);
    expect(run({ div: [7, 0] })).toBeNull();
    expect(run({ add: [null, 3] })).toBeNull();
    expect(run({ add: [1] })).toBeNull();
    expect(run({ lt: [1, 2] })).toBe(true);
    expect(run({ lte: [2, 2] })).toBe(true);
    expect(run({ gt: [1, 2] })).toBe(false);
    expect(run({ gte: [2, 2] })).toBe(true);
    expect(run({ lt: [null, 2] })).toBe(false);
    expect(run({ lt: [1] })).toBe(false);
    expect(run({ eq: [top(), top()] })).toBe(true);
    expect(run({ eq: [top(), top(2)] })).toBe(false);
    expect(run({ neq: ["a", "b"] })).toBe(true);
    expect(run({ eq: [] })).toBe(true);
  });

  it("combines predicates and iterates zones", () => {
    expect(run({ all: [true, { not: false }] })).toBe(true);
    expect(run({ any: [false, null] })).toBe(false);
    expect(run({ all: "not a list" })).toBe(true);
    expect(run({ isEmpty: "pile.3" })).toBe(true);
    expect(run({ isNull: top(9) })).toBe(true);
    expect(run({ countZones: { type: "pile", as: "p", where: { isEmpty: { ref: "p" } } } })).toBe(
      1,
    );
    expect(run({ countZones: { type: "pile", as: "p" } })).toBe(3);
    expect(run({ forAll: { type: "pile", as: "p" } })).toBe(true);
    expect(
      run({ forAll: { type: "pile", as: "p", where: { gte: [{ count: { ref: "p" } }, 0] } } }),
    ).toBe(true);
    expect(
      run({ exists: { type: "pile", as: "p", where: { gt: [{ count: { ref: "p" } }, 3] } } }),
    ).toBe(true);
    expect(holds({ eq: [1, 1] }, ctx())).toBe(true);
    expect(holds(1, ctx())).toBe(false);
  });

  it("switches on values with a default", () => {
    const sw = (value: Expr, withDefault = true) => ({
      switch: value,
      cases: { EASY: 1, "2": 2 },
      ...(withDefault ? { default: 9 } : {}),
    });
    expect(run(sw({ option: "mode" }))).toBe(1);
    expect(run(sw(2))).toBe(2);
    expect(run(sw("OTHER"))).toBe(9);
    expect(run(sw("OTHER", false))).toBeNull();
    expect(run({ switch: 1, cases: null })).toBeNull();
  });

  it("answers reversesLastAction only while scoring hints", () => {
    expect(run({ reversesLastAction: true })).toBe(false);
    expect(run({ reversesLastAction: true }, { reversesLastAction: () => true })).toBe(true);
  });

  it("rejects malformed expressions and unbound names", () => {
    expect(() => run([1, 2] as Expr)).toThrow(/array/);
    expect(() => run({ bogus: 1 })).toThrow(/Unknown expression operator/);
    expect(() => run({})).toThrow(/Unknown expression operator/);
    expect(() => run({ param: "missing" })).toThrow(/Unbound param/);
    expect(() => run({ ref: "missing" })).toThrow(/Unbound ref/);
    expect(() => zoneOf("pile.9", ctx())).toThrow(/Expected a zone/);
    expect(() => zoneOf(5, ctx())).toThrow(/Expected a zone/);
  });
});

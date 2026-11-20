import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createBundledRulesRepository } from "../../src/game-catalog";
import {
  compileRules,
  type CompiledGame,
  type GameEvent,
  type GameState,
} from "../../src/game-engine";
import { toyRules } from "./toyRules";

/** Property tests (game-engine.md section 14.3 and 14.4) over random seeds and random legal walks. */

const spider = createBundledRulesRepository().compiled("spider-solitaire");
const toy = compileRules(toyRules());
const RUNS = { numRuns: 25 };

const seedArb = fc
  .array(fc.integer({ min: 0, max: 0xffffffff }), { minLength: 4, maxLength: 4 })
  .map((parts) => parts.map((part) => part.toString(16).padStart(8, "0")).join(""));
const walkArb = fc.array(fc.nat(), { maxLength: 40 });
const spiderOptionsArb = fc.record({
  suits: fc.constantFrom(1, 2, 4),
  dealStyle: fc.constantFrom("MICROSOFT", "HOYLE"),
});

interface Walk {
  states: GameState[];
  events: GameEvent[][];
}

/** Plays listed actions chosen by the walk, keeping every state and its events. */
function walk(
  game: CompiledGame,
  options: Record<string, unknown>,
  seed: string,
  choices: number[],
): Walk {
  let state = game.createGame({ options, seed, seats: ["S1"] });
  const result: Walk = { states: [state], events: [] };
  for (const choice of choices) {
    const listed = game.listLegalActions(state, "S1");
    if (listed.length === 0) break;
    const applied = game.applyAction(
      state,
      "S1",
      (listed[choice % listed.length] as { actionId: string }).actionId,
    );
    state = applied.state;
    result.states.push(state);
    result.events.push(applied.events);
  }
  return result;
}

/** Every Spider action id with parameters in their widest plausible ranges. */
const SPIDER_CANDIDATES = [
  "DEAL_ROW",
  ...Array.from({ length: 10 }, (_, from) =>
    Array.from({ length: 13 }, (_, depth) =>
      Array.from(
        { length: 10 },
        (_, to) =>
          `MOVE_UNIT|from=tableau.${String(from + 1)}|depth=${String(depth + 1)}|to=tableau.${String(to + 1)}`,
      ),
    ),
  ).flat(2),
];

function conserved(state: GameState): boolean {
  const placed = Object.values(state.zones).flat();
  return (
    placed.length === Object.keys(state.cards).length && new Set(placed).size === placed.length
  );
}

describe("engine properties", () => {
  it("conserves cards, and every listed action validates and applies", () => {
    for (const game of [spider, toy]) {
      fc.assert(
        fc.property(seedArb, walkArb, (seed, choices) => {
          for (const state of walk(game, {}, seed, choices).states) {
            expect(conserved(state)).toBe(true);
            for (const action of game.listLegalActions(state, "S1")) {
              expect(game.validateAction(state, "S1", action.actionId).valid).toBe(true);
            }
          }
        }),
        RUNS,
      );
    }
  });

  it("accepts exactly the listed Spider actions and rejects every other id", () => {
    fc.assert(
      fc.property(spiderOptionsArb, seedArb, walkArb, (options, seed, choices) => {
        const state = walk(spider, options, seed, choices).states.at(-1) as GameState;
        const listed = new Set(
          spider.listLegalActions(state, "S1").map((action) => action.actionId),
        );
        for (const actionId of SPIDER_CANDIDATES) {
          expect(spider.validateAction(state, "S1", actionId).valid).toBe(listed.has(actionId));
        }
      }),
      { numRuns: 10 },
    );
  });

  it("restores the previous view exactly when an action is undone", () => {
    for (const game of [spider, toy]) {
      fc.assert(
        fc.property(seedArb, walkArb, fc.nat(), (seed, choices, pick) => {
          const before = walk(game, {}, seed, choices).states.at(-1) as GameState;
          const listed = game.listLegalActions(before, "S1");
          if (listed.length === 0) return;
          const after = game.applyAction(
            before,
            "S1",
            (listed[pick % listed.length] as { actionId: string }).actionId,
          ).state;
          if (after.status !== "IN_PROGRESS") return;
          const undone = game.undo(after, "S1").state;
          expect(game.getView(undone, "S1").zones).toEqual(game.getView(before, "S1").zones);
          expect(undone.cards).toEqual(before.cards);
          expect(undone.history).toEqual(before.history);
        }),
        RUNS,
      );
    }
  });

  it("never reveals a face-down or stock card in views, legal actions or events", () => {
    fc.assert(
      fc.property(spiderOptionsArb, seedArb, walkArb, (options, seed, choices) => {
        const played = walk(spider, options, seed, choices);
        played.states.forEach((state, i) => {
          const hidden = Object.entries(state.cards)
            .filter(([, card]) => !card.faceUp)
            .map(([cardId]) => `"${cardId}"`);
          const shown = JSON.stringify([
            spider.getView(state, "S1"),
            spider.listLegalActions(state, "S1"),
            played.events[i - 1] ?? [],
          ]);
          for (const cardId of hidden) expect(shown).not.toContain(cardId);
          expect(shown).not.toContain(state.seed);
        });
      }),
      { numRuns: 15 },
    );
  });
});

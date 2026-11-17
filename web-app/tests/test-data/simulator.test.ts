import { describe, expect, it } from "vitest";
import { createCards, seededRandom, shuffle } from "../../test-data/spider/cards";
import {
  applyAction,
  createSpider,
  hint,
  isWon,
  legalActions,
  parseOptions,
  runLength,
  undo,
  type SpiderState,
} from "../../test-data/spider/simulator";
import { must } from "../must";

const counts = (state: SpiderState): number[] =>
  Array.from(
    { length: 10 },
    (_, index) => state.zones[`tableau.${String(index + 1)}`]?.length ?? 0,
  );

describe("prototype Spider simulator", () => {
  it("deals the Microsoft and Hoyle layouts", () => {
    const microsoft = createSpider(parseOptions({ suits: 1 }), 7);
    expect(counts(microsoft)).toEqual([6, 6, 6, 6, 5, 5, 5, 5, 5, 5]);
    expect(microsoft.zones["stock.1"]).toHaveLength(50);
    const hoyle = createSpider(parseOptions({ suits: 4, dealStyle: "HOYLE" }), 7);
    expect(counts(hoyle)).toEqual(Array<number>(10).fill(5));
    expect(hoyle.zones["stock.1"]).toHaveLength(54);
  });

  it("builds 104 cards for every suit option and defaults unknown options", () => {
    for (const suits of [1, 2, 4]) expect(createCards(suits)).toHaveLength(104);
    expect(parseOptions({ suits: 3 })).toEqual({ suits: 1, dealStyle: "MICROSOFT" });
    expect(parseOptions(undefined)).toEqual({ suits: 1, dealStyle: "MICROSOFT" });
  });

  it("is deterministic per seed", () => {
    expect(shuffle([1, 2, 3, 4, 5], seededRandom(3))).toEqual(
      shuffle([1, 2, 3, 4, 5], seededRandom(3)),
    );
    expect(createSpider(parseOptions({}), 11).zones).toEqual(
      createSpider(parseOptions({}), 11).zones,
    );
  });

  it("applies only legal actions and scores moves", () => {
    const state = createSpider(parseOptions({}), 7);
    expect(applyAction(state, "MOVE_UNIT|from=tableau.1|depth=9|to=tableau.2")).toBeNull();
    const events = applyAction(state, "DEAL_ROW");
    expect(events?.[0]?.type).toBe("CARDS_DEALT");
    expect(state.vars).toMatchObject({ score: 499, moveCount: 1 });
    expect(state.zones["stock.1"]).toHaveLength(40);
  });

  it("forbids dealing with an empty column and moving a whole column to an empty one", () => {
    const state = createSpider(parseOptions({}), 7);
    state.zones["tableau.10"] = [];
    expect(legalActions(state).some((action) => action.actionId === "DEAL_ROW")).toBe(false);
    const wholeColumn = legalActions(state).filter(
      (action) =>
        action.descriptor.kind === "MOVE_CARDS" &&
        action.descriptor.to.zoneId === "tableau.10" &&
        action.descriptor.cards.length === state.zones[action.descriptor.from.zoneId]?.length,
    );
    expect(wholeColumn).toEqual([]);
  });

  it("completes a run of thirteen, flips the exposed card and wins with eight runs", () => {
    const state = createSpider(parseOptions({}), 7);
    const spades = Object.values(state.cards).filter((card) => card.suit === "SPADES");
    const run = Array.from({ length: 13 }, (_, index) =>
      must(spades.find((card) => card.rank === 13 - index)),
    );
    const hidden = must(Object.values(state.cards).find((card) => !run.includes(card)));
    hidden.faceUp = false;
    for (const card of run) card.faceUp = true;
    state.zones["tableau.1"] = [hidden.id, ...run.slice(0, 12).map((card) => card.id)];
    state.zones["tableau.2"] = [must(run[12]).id];
    expect(runLength(state, "tableau.1")).toBe(12);
    const aceOntoTwo = "MOVE_UNIT|from=tableau.2|depth=1|to=tableau.1";
    state.vars.completedRuns = 7;
    const events = applyAction(state, aceOntoTwo);
    expect(events?.map((event) => event.type)).toEqual([
      "CARDS_MOVED",
      "RUN_COMPLETED",
      "CARD_FLIPPED",
    ]);
    expect(state.vars.score).toBe(599);
    expect(isWon(state)).toBe(true);
  });

  it("undoes by replay with the Microsoft undo penalty and suggests hints", () => {
    const state = createSpider(parseOptions({}), 7);
    expect(undo(state)).toBeNull();
    const first = hint(state);
    expect(first).not.toBeNull();
    applyAction(state, must(first).actionId);
    const reverted = must(undo(state));
    expect(reverted.history).toEqual([]);
    expect(reverted.vars).toMatchObject({ score: 498, undoCount: 1, moveCount: 1 });
  });
});

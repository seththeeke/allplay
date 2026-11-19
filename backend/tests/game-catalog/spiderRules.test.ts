import { describe, expect, it } from "vitest";
import { createBundledRulesRepository, UnknownGameError } from "../../src/game-catalog";
import type { GameState } from "../../src/game-engine";
import { arrange, type CardSpec } from "../game-engine/arrange";

const repository = createBundledRulesRepository();
const spider = repository.compiled("spider-solitaire");
const SEED = "00000000000000000000000000000007";

const start = (options: Record<string, unknown> = {}) =>
  spider.createGame({ options, seed: SEED, seats: ["S1"] });
const counts = (state: GameState, type: string, n: number) =>
  Array.from({ length: n }, (_, i) => state.zones[`${type}.${String(i + 1)}`]?.length);
const ids = (state: GameState) =>
  spider.listLegalActions(state, "S1").map((action) => action.actionId);
const up = (rank: number, suit: CardSpec[1] = "SPADES"): CardSpec => [rank, suit, true];
const down = (rank: number, suit: CardSpec[1] = "SPADES"): CardSpec => [rank, suit, false];

const FILLER: CardSpec[] = [up(13, "HEARTS"), up(1, "HEARTS"), up(13), up(1)];

/**
 * Ten columns from specs. Unlisted columns get one face-up king or ace, which
 * can never move onto each other, so deals stay legal and the filler adds no
 * moves of its own.
 */
function table(
  columns: Record<number, CardSpec[]>,
  options: Record<string, unknown> = { suits: 2 },
): GameState {
  const zones: Record<string, CardSpec[]> = {};
  for (let i = 1; i <= 10; i += 1)
    zones[`tableau.${String(i)}`] = columns[i] ?? [FILLER[i % FILLER.length] as CardSpec];
  return arrange(start(options), zones, "stock.1");
}

describe("Spider deals", () => {
  for (const suits of [1, 2, 4]) {
    for (const dealStyle of ["MICROSOFT", "HOYLE"]) {
      it(`deals ${String(suits)} suit ${dealStyle}`, () => {
        const state = start({ suits, dealStyle });
        const microsoft = dealStyle === "MICROSOFT";
        expect(counts(state, "tableau", 10)).toEqual(
          microsoft ? [6, 6, 6, 6, 5, 5, 5, 5, 5, 5] : Array(10).fill(5),
        );
        expect(state.zones["stock.1"]).toHaveLength(microsoft ? 50 : 54);
        const cards = Object.values(state.cards);
        expect(cards).toHaveLength(104);
        expect(new Set(cards.map((card) => card.suit)).size).toBe(suits);
        for (let i = 1; i <= 10; i += 1) {
          const column = state.zones[`tableau.${String(i)}`] as string[];
          expect(column.map((id) => state.cards[id]?.faceUp)).toEqual(
            column.map((_, j) => j === column.length - 1),
          );
        }
        expect(state.vars).toMatchObject({ score: 500, completedRuns: 0 });
      });
    }
  }
});

describe("Spider moves", () => {
  it("stops a movable unit at a suit change and at a face-down card", () => {
    const state = table({
      1: [down(9), up(6, "HEARTS"), up(5), up(4)],
      2: [up(7, "HEARTS")],
      3: [up(6)],
    });
    const moves = ids(state).filter((id) => id.startsWith("MOVE_UNIT|from=tableau.1|"));
    expect(moves).toContain("MOVE_UNIT|from=tableau.1|depth=2|to=tableau.3");
    expect(moves.some((id) => id.includes("depth=3"))).toBe(false);
  });

  it("accepts any suit one rank higher and any unit on an empty column, but not a whole column onto an empty one", () => {
    const state = table({ 1: [down(9), up(4, "HEARTS")], 2: [up(5)], 3: [], 4: [up(13)] });
    const legal = ids(state);
    expect(legal).toContain("MOVE_UNIT|from=tableau.1|depth=1|to=tableau.2");
    expect(legal).toContain("MOVE_UNIT|from=tableau.1|depth=1|to=tableau.3");
    expect(legal).not.toContain("MOVE_UNIT|from=tableau.4|depth=1|to=tableau.3");
    expect(legal).not.toContain("DEAL_ROW");
  });

  it("groups moves to empty columns by equivalence key", () => {
    const state = table({ 1: [down(9), up(4)], 3: [], 6: [] });
    const toEmpty = spider
      .listLegalActions(state, "S1")
      .filter(
        (action) =>
          action.actionId.startsWith("MOVE_UNIT|from=tableau.1|") &&
          action.equivalenceKey !== undefined,
      );
    expect(toEmpty.map((action) => action.actionId)).toEqual([
      "MOVE_UNIT|from=tableau.1|depth=1|to=tableau.3",
      "MOVE_UNIT|from=tableau.1|depth=1|to=tableau.6",
    ]);
    expect(new Set(toEmpty.map((action) => action.equivalenceKey))).toEqual(
      new Set(["MOVE_UNIT|from=tableau.1|depth=1|to=*"]),
    );
    expect(toEmpty[0]?.text).toBe("Move four of spades from column 1 to empty column 3");
    expect(toEmpty[0]?.shortText).toBe("column 1 to empty column 3");
  });

  it("costs a point per move and deal, and describes the deal", () => {
    const state = start();
    const deal = spider
      .listLegalActions(state, "S1")
      .find((action) => action.actionId === "DEAL_ROW");
    expect(deal).toMatchObject({
      text: "Deal a new row of cards",
      shortText: "deal",
      descriptor: { kind: "DEAL", cardCount: 10 },
    });
    const dealt = spider.applyAction(state, "S1", "DEAL_ROW").state;
    expect(dealt.vars).toMatchObject({ score: 499, moveCount: 1 });
    expect(counts(dealt, "tableau", 10)).toEqual([7, 7, 7, 7, 6, 6, 6, 6, 6, 6]);
  });
});

describe("Spider runs, scoring and undo", () => {
  const run: CardSpec[] = [down(9, "HEARTS"), ...Array.from({ length: 12 }, (_, i) => up(13 - i))];

  it("completes a run: moves 13 cards to a foundation, adds 100 and flips the exposed card", () => {
    const state = table({ 1: run, 2: [up(1)] });
    const result = spider.applyAction(state, "S1", "MOVE_UNIT|from=tableau.2|depth=1|to=tableau.1");
    expect(result.state.zones["foundation.1"]).toHaveLength(13);
    expect(result.state.vars).toMatchObject({ completedRuns: 1, score: 500 - 1 + 100 });
    const exposed = result.state.zones["tableau.1"]?.[0] as string;
    expect(result.state.cards[exposed]?.faceUp).toBe(true);
    const completed = result.events.find((event) => event.type === "RUN_COMPLETED");
    expect(completed?.speech).toBe("Completed a run of spades");
    expect(completed?.data).toEqual({ zone: "tableau.1", suit: "SPADES" });
  });

  it("an undo costs a point, keeps the move's point and takes back the run bonus", () => {
    const state = start({ suits: 1 });
    const moved = spider.applyAction(state, "S1", "DEAL_ROW").state;
    const undone = spider.undo(moved, "S1").state;
    expect(undone.vars).toMatchObject({ score: 500 - 1 - 1, undoCount: 1, moveCount: 0 });
    expect(undone.zones).toEqual(state.zones);
  });
});

describe("Spider hints", () => {
  it("prefers exposing a face-down card over a lateral move", () => {
    const state = table({
      1: [down(9), up(4, "HEARTS")],
      2: [up(5)],
      3: [up(10), up(4)],
      4: [up(5, "HEARTS")],
    });
    /* Both fives take the four and expose a card; the same-suit five scores higher. */
    expect(spider.getHint(state, "S1")?.actionId).toBe(
      "MOVE_UNIT|from=tableau.1|depth=1|to=tableau.4",
    );
  });

  it("suggests dealing only when no move has positive weight", () => {
    const state = table({});
    expect(spider.getHint(state, "S1")?.actionId).toBe("DEAL_ROW");
  });

  it("never suggests reversing the previous move while another move exists", () => {
    const state = start({ suits: 1 });
    const first = spider.getHint(state, "S1");
    if (first?.descriptor.kind !== "MOVE_CARDS") throw new Error("expected a move hint");
    const after = spider.applyAction(state, "S1", first.actionId).state;
    const reverse = `MOVE_UNIT|from=${first.descriptor.to.zoneId}|depth=1|to=${first.descriptor.from.zoneId}`;
    expect(spider.getHint(after, "S1")?.actionId).not.toBe(reverse);
  });
});

describe("Spider view and catalog", () => {
  it("shows only the stock size and hides face-down cards", () => {
    const view = spider.getView(start(), "S1");
    expect(view.zones.find((zone) => zone.zoneId === "stock.1")).toMatchObject({
      cards: null,
      count: 50,
      label: "stock",
    });
    const column = view.zones.find((zone) => zone.zoneId === "tableau.1");
    expect(column?.label).toBe("column 1");
    expect(column?.cards?.slice(0, 5)).toEqual(Array(5).fill({ faceUp: false }));
    expect(view.zones.find((zone) => zone.zoneId === "foundation.3")?.label).toBe("completed run");
  });

  it("serves the catalog and rules documents", async () => {
    expect(spider.catalogEntry).toMatchObject({
      gameId: "spider-solitaire",
      path: "/spider",
      latestVersion: 1,
    });
    expect(await repository.list()).toEqual([spider.catalogEntry]);
    expect((await repository.latest("spider-solitaire")).version).toBe(1);
    expect((await repository.get("spider-solitaire", 1)).speech.deciderGuidance).toHaveLength(5);
    expect(repository.compiled("spider-solitaire", 1)).toBe(spider);
    expect(() => repository.compiled("chess")).toThrow(UnknownGameError);
    expect(() => repository.compiled("spider-solitaire", 9)).toThrow(/v9/);
    await expect(repository.get("chess", 1)).rejects.toThrow(UnknownGameError);
  });

  it("refuses an invalid bundled document at load", () => {
    expect(() => createBundledRulesRepository({ broken: [{ gameId: "broken" }] })).toThrow(
      /Rules document is invalid/,
    );
  });
});

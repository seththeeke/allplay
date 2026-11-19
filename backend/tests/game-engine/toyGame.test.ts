import { describe, expect, it } from "vitest";
import {
  compileRules,
  EngineInvariantError,
  IllegalActionError,
  InvalidGameInputError,
  UndoUnavailableError,
  type CompiledGame,
  type GameState,
} from "../../src/game-engine";
import { arrange } from "./arrange";
import { toyRules } from "./toyRules";

const SEED = "0000000000000000000000000000abcd";
const game = compileRules(toyRules());

function start(options: Record<string, unknown> = {}, compiled: CompiledGame = game): GameState {
  return compiled.createGame({ options, seed: SEED, seats: ["S1"] });
}

const ids = (state: GameState, compiled: CompiledGame = game) =>
  compiled.listLegalActions(state, "S1").map((action) => action.actionId);

function variant(change: (rules: ReturnType<typeof toyRules>) => void): CompiledGame {
  const rules = toyRules();
  change(rules);
  return compileRules(rules);
}

describe("createGame", () => {
  it("creates cards, runs setup and settles triggers", () => {
    const state = start();
    expect(state.version).toBe(0);
    expect(state.status).toBe("IN_PROGRESS");
    expect(state.options).toEqual({ mode: "EASY", size: 1 });
    expect(Object.keys(state.cards)).toHaveLength(33);
    expect(state.zones["deck.1"]).toHaveLength(14);
    expect(state.zones["done.2"]).toHaveLength(13);
    for (const pile of ["pile.1", "pile.2", "pile.3"]) {
      const cards = state.zones[pile] as string[];
      expect(cards).toHaveLength(2);
      expect(state.cards[cards[0] as string]?.faceUp).toBe(false);
      expect(state.cards[cards[1] as string]?.faceUp).toBe(true);
    }
    expect(state.vars).toEqual({
      score: 0,
      moveCount: 0,
      undoCount: 0,
      banked: 0,
      flagged: 0,
      peeks: 0,
      bonus: 11,
    });
  });

  it("follows option switches and accepts option values in string form", () => {
    const state = start({ mode: "HARD", size: "2" });
    expect(state.options).toEqual({ mode: "HARD", size: 2 });
    expect(state.zones["deck.1"]).toHaveLength(27);
    expect(Object.values(state.cards).filter((card) => card.suit === "DIAMONDS")).toHaveLength(13);
    expect(state.vars["bonus"]).toBe(12);
  });

  it("is deterministic for a seed", () => {
    expect(start()).toEqual(start());
  });

  it("rejects unknown and invalid options, bad seeds and wrong seat counts", () => {
    expect(() => start({ colour: "red" })).toThrow(InvalidGameInputError);
    expect(() => start({ mode: "MEDIUM" })).toThrow(/Invalid value for option mode/);
    expect(() => game.createGame({ options: {}, seed: "nope", seats: ["S1"] })).toThrow(
      InvalidGameInputError,
    );
    expect(() => game.createGame({ options: {}, seed: SEED, seats: [] })).toThrow(/1 to 1 seats/);
  });

  it("fails rules whose triggers never settle", () => {
    const looping = variant((rules) => {
      (rules["triggers"] as unknown[]).push({
        id: "LOOP",
        when: true,
        effects: [{ addVar: { name: "peeks", by: 0 } }],
      });
    });
    expect(() => start({}, looping)).toThrow(EngineInvariantError);
  });

  it("fails a deal that runs out of cards", () => {
    const greedy = variant((rules) => {
      (rules["setup"] as Record<string, unknown>[])[4] = {
        dealRows: { from: "deck.1", type: "pile", counts: [30, 30, 30], faceUp: false },
      };
    });
    expect(() => start({}, greedy)).toThrow(/Not enough cards/);
  });
});

describe("legal actions and apply", () => {
  const table = arrange(
    start(),
    {
      "pile.1": [
        [5, "SPADES", false],
        [3, "SPADES", true],
      ],
      "pile.2": [[4, "HEARTS", true]],
      "pile.3": [],
      "done.2": [[1, "CLUBS", true]],
    },
    "deck.1",
  );

  it("lists bindings in template and domain order, with equivalence keys for empty targets", () => {
    const actions = game.listLegalActions(table, "S1");
    expect(actions.map((action) => action.actionId)).toEqual([
      "SHIFT|from=pile.1|n=1|to=pile.2",
      "SHIFT|from=pile.1|n=1|to=pile.3",
      "SHIFT|from=pile.2|n=1|to=pile.3",
      "DRAW",
      "BANK|src=pile.1",
      "BANK|src=pile.2",
      "TURN|at=pile.1",
      "TURN|at=pile.2",
    ]);
    const toEmpty = actions[1];
    expect(toEmpty?.equivalenceKey).toBe("SHIFT|from=pile.1|n=1|to=*");
    expect(actions[0]?.equivalenceKey).toBeUndefined();
    expect(actions[0]?.descriptor).toEqual({
      kind: "MOVE_CARDS",
      cards: [
        { cardId: expect.any(String) as string, suit: "SPADES", rank: 3, name: "three of spades" },
      ],
      from: { zoneId: "pile.1", type: "pile", index: 1, label: "pile 1" },
      to: {
        zoneId: "pile.2",
        type: "pile",
        index: 2,
        label: "pile 2",
        topCard: {
          cardId: expect.any(String) as string,
          suit: "HEARTS",
          rank: 4,
          name: "four of hearts",
        },
      },
    });
    expect(actions[0]?.text).toBe(
      "Shift 1 from pile 1 to pile 2 onto four of hearts, lead three of spades, n 1 0",
    );
    expect(toEmpty?.text).toContain("to empty pile 3 onto empty");
    expect(actions[3]?.descriptor).toEqual({
      kind: "DEAL",
      from: { zoneId: "deck.1", type: "deck", index: 1, label: "deck" },
      cardCount: 3,
    });
    expect(actions[3]?.text).toBe("Draw ");
    expect(actions[4]?.descriptor).toEqual({ kind: "OTHER" });
    expect(actions[6]?.descriptor).toEqual({ kind: "OTHER" });
  });

  it("moves cards, scores, counts the move and flips the exposed card", () => {
    const result = game.applyAction(table, "S1", "SHIFT|from=pile.1|n=1|to=pile.2");
    expect(result.state.zones["pile.2"]).toHaveLength(2);
    expect(result.state.vars).toMatchObject({ score: -1, moveCount: 1 });
    expect(result.state.history).toEqual(["SHIFT|from=pile.1|n=1|to=pile.2"]);
    expect(result.state.version).toBe(1);
    expect(result.events.map((event) => event.type)).toEqual([
      "CARDS_MOVED",
      "VAR_CHANGED",
      "VAR_CHANGED",
      "CARD_FLIPPED",
    ]);
    expect(result.events[3]?.data).toMatchObject({
      zone: "pile.1",
      faceUp: true,
      cardId: expect.any(String) as string,
    });
    expect(table.history).toEqual([]);
  });

  it("deals a row without counting a move and hides dealt face-down cards from events", () => {
    const result = game.applyAction(table, "S1", "DRAW");
    expect(result.state.vars["moveCount"]).toBe(0);
    expect(result.events[0]).toMatchObject({
      type: "CARDS_DEALT",
      data: { count: 3, to: ["pile.1", "pile.2", "pile.3"] },
    });
    const hidden = variant((rules) => {
      ((rules["actions"] as Record<string, unknown>[])[1] as { effects: unknown[] }).effects = [
        { dealRow: { from: "deck.1", type: "pile", faceUp: false } },
      ];
    });
    const dealt = hidden.applyAction(table, "S1", "DRAW");
    expect(dealt.events[0]?.data).toMatchObject({ cardIds: [] });
  });

  it("deals until the source runs out", () => {
    const short = arrange(
      start(),
      {
        "deck.1": [[2, "HEARTS", false]],
        "pile.1": [[1, "SPADES", true]],
        "pile.2": [[1, "HEARTS", true]],
      },
      "done.1",
    );
    const result = game.applyAction(short, "S1", "DRAW");
    expect(result.events[0]?.data).toMatchObject({ count: 1, to: ["pile.1"] });
  });

  it("emits rule events with speech, banks to the first empty zone, and wins", () => {
    const result = game.applyAction(table, "S1", "BANK|src=pile.2");
    expect(result.state.zones["done.1"]).toHaveLength(1);
    expect(result.state.status).toBe("WON");
    expect(result.status).toEqual({ status: "WON", blocked: false, canUndo: false });
    const banked = result.events.find((event) => event.type === "BANKED");
    expect(banked?.speech).toBe(
      "Banked " + String(banked?.data["top"]) + " from empty pile 2 of hearts, score 5   ",
    );
    expect(banked?.data["cards"]).toEqual([banked?.data["top"]]);
    expect(result.events.at(-1)).toEqual({ type: "GAME_WON", data: {}, speech: null });
    expect(game.listLegalActions(result.state, "S1")).toEqual([]);
  });

  it("runs a trigger without forEach and the LOST end condition", () => {
    const hard = arrange(
      start({ mode: "HARD" }),
      {
        "pile.1": [[5, "SPADES", true]],
        "pile.2": [[4, "SPADES", true]],
        "pile.3": [[3, "SPADES", true]],
      },
      "deck.1",
    );
    const once = game.applyAction(hard, "S1", "BANK|src=pile.1").state;
    const twice = game.applyAction(once, "S1", "BANK|src=pile.2");
    expect(twice.state.vars).toMatchObject({ banked: 2, flagged: 1, score: 20 });
    expect(twice.state.status).toBe("WON");
    const peeked = game.applyAction(game.applyAction(hard, "S1", "PEEK").state, "S1", "PEEK");
    expect(peeked.state.status).toBe("LOST");
    expect(peeked.events.at(-1)?.type).toBe("GAME_LOST");
    expect(game.applyAction(hard, "S1", "PEEK").events[0]?.speech).toBeNull();
    expect(ids(hard)).toContain("PEEK");
  });

  it("turns a card face down and the flip trigger turns it back", () => {
    const result = game.applyAction(table, "S1", "TURN|at=pile.2");
    expect(
      result.events
        .filter((event) => event.type === "CARD_FLIPPED")
        .map((event) => event.data["faceUp"]),
    ).toEqual([false, true]);
  });

  it("validates seats, status, ids and legality", () => {
    expect(game.validateAction(table, "S2", "DRAW")).toEqual({
      valid: false,
      reason: "NOT_SEATED",
    });
    expect(game.validateAction({ ...table, status: "WON" }, "S1", "DRAW")).toEqual({
      valid: false,
      reason: "GAME_OVER",
    });
    for (const actionId of [
      "NOPE",
      "SHIFT|from=pile.1",
      "SHIFT|to=pile.1|n=1|from=pile.2",
      "SHIFT|from=|n=1|to=pile.2",
      "DRAW|extra=1",
    ]) {
      expect(game.validateAction(table, "S1", actionId)).toEqual({
        valid: false,
        reason: "UNKNOWN_ACTION",
      });
    }
    for (const actionId of [
      "SHIFT|from=deck.1|n=1|to=pile.2",
      "SHIFT|from=pile.3|n=1|to=pile.2",
      "SHIFT|from=pile.1|n=2|to=pile.2",
      "SHIFT|from=pile.1|n=1|to=pile.1",
      "SHIFT|from=pile.2|n=1|to=pile.1",
    ]) {
      expect(game.validateAction(table, "S1", actionId)).toEqual({
        valid: false,
        reason: "NOT_LEGAL",
      });
    }
    const valid = game.validateAction(table, "S1", "DRAW");
    expect(valid.valid && valid.action.actionId).toBe("DRAW");
    expect(() => game.applyAction(table, "S1", "SHIFT|from=pile.2|n=1|to=pile.1")).toThrow(
      IllegalActionError,
    );
    expect(game.listLegalActions(table, "S2")).toEqual([]);
  });

  it("guards card conservation", () => {
    const duplicated = structuredClone(table);
    (duplicated.zones["pile.3"] as string[]).push(
      (duplicated.zones["pile.2"] as string[])[0] as string,
    );
    expect(() => game.applyAction(duplicated, "S1", "DRAW")).toThrow(/duplicated or unknown/);
    const lost = structuredClone(table);
    (lost.zones["deck.1"] as string[]).pop();
    expect(() => game.applyAction(lost, "S1", "DRAW")).toThrow(/missing/);
  });
});

describe("undo", () => {
  const table = arrange(
    start(),
    {
      "pile.1": [
        [5, "SPADES", false],
        [3, "SPADES", true],
      ],
      "pile.2": [[4, "HEARTS", true]],
      "done.2": [[1, "CLUBS", true]],
    },
    "deck.1",
  );

  it("cannot undo with no history, for another seat, or when the rules forbid it", () => {
    const fresh = start();
    expect(game.getStatus(fresh).canUndo).toBe(false);
    expect(() => game.undo(fresh, "S1")).toThrow(UndoUnavailableError);
    expect(() => game.undo(fresh, "S2")).toThrow(IllegalActionError);
    const strict = variant((rules) => {
      rules["undo"] = { allowed: false, score: 0, refundUndoneAction: false };
    });
    const moved = strict.applyAction(
      strict.createGame({ options: {}, seed: SEED, seats: ["S1"] }),
      "S1",
      "DRAW",
    ).state;
    expect(strict.getStatus(moved).canUndo).toBe(false);
  });

  it("replays from the seed, refunding the undone action when the rules say so", () => {
    const drawn = game.applyAction(start(), "S1", "DRAW").state;
    const turned = game.applyAction(drawn, "S1", "TURN|at=pile.1").state;
    expect(turned.vars["score"]).toBe(-1);
    const undone = game.undo(turned, "S1");
    expect(undone.state.zones).toEqual(drawn.zones);
    expect(undone.state.vars).toMatchObject({ score: -2, undoCount: 1, moveCount: 0 });
    expect(undone.state.scoreCarry).toBe(-2);
    expect(undone.state.version).toBe(3);
    expect(undone.state.history).toEqual(["DRAW"]);
    expect(undone.events).toEqual([
      { type: "ACTION_UNDONE", data: { actionId: "TURN|at=pile.1" }, speech: null },
    ]);
  });

  it("keeps the undone action's score when not refunded", () => {
    const keeping = variant((rules) => {
      rules["undo"] = { allowed: true, score: -1, refundUndoneAction: false };
    });
    const state = keeping.createGame({ options: {}, seed: SEED, seats: ["S1"] });
    const turned = keeping.applyAction(state, "S1", "TURN|at=pile.1").state;
    const after = keeping.undo(turned, "S1");
    expect(after.state.vars["score"]).toBe(-2);
    expect(after.state.scoreCarry).toBe(-2);
  });

  it("refuses a history that does not replay", () => {
    const moved = game.applyAction(table, "S1", "DRAW").state;
    const corrupt = { ...moved, history: ["SHIFT|from=pile.3|n=1|to=pile.1", "DRAW"] };
    expect(() => game.undo(corrupt, "S1")).toThrow(IllegalActionError);
    expect(() => game.undo({ ...moved, history: ["NOPE", "DRAW"] }, "S1")).toThrow(
      IllegalActionError,
    );
  });
});

describe("hints and views", () => {
  it("picks the highest weight, avoids reversing the last action, and is null when nothing is legal", () => {
    const table = arrange(
      start({ mode: "HARD" }),
      {
        "pile.1": [[3, "SPADES", true]],
        "pile.2": [[2, "HEARTS", true]],
        "pile.3": [[5, "SPADES", true]],
        "done.1": [[1, "SPADES", true]],
        "done.2": [[1, "HEARTS", true]],
      },
      "deck.1",
    );
    const noBank = variant((rules) => {
      (rules["hints"] as { weights: { action?: string }[] }).weights[0] = {
        action: "SHIFT",
        weight: 1,
        when: true,
      } as never;
    });
    const moved = noBank.applyAction(table, "S1", "SHIFT|from=pile.2|n=1|to=pile.1").state;
    const hint = noBank.getHint(moved, "S1");
    expect(hint?.actionId).not.toBe("SHIFT|from=pile.1|n=1|to=pile.2");
    expect(game.getHint(start(), "S1")?.templateId).toBe("BANK");
    expect(game.getHint(start(), "S2")).toBeNull();
    const won = game.applyAction(start(), "S1", "BANK|src=pile.1").state;
    expect(game.getHint(won, "S1")).toBeNull();
    expect(game.getStatus(won).blocked).toBe(false);
  });

  it("redacts face-down cards and count-only zones", () => {
    const view = game.getView(start(), "S1");
    const deck = view.zones.find((zone) => zone.zoneId === "deck.1");
    expect(deck).toMatchObject({
      count: 14,
      cards: null,
      layout: "STACK",
      region: "BOTTOM",
      label: "deck",
    });
    const pile = view.zones.find((zone) => zone.zoneId === "pile.1");
    expect(pile?.cards?.[0]).toEqual({ faceUp: false });
    expect(pile?.cards?.[1]).toMatchObject({ faceUp: true, cardId: expect.any(String) as string });
    expect(JSON.stringify(view)).not.toContain(SEED);
    expect(view.status).toEqual({ status: "IN_PROGRESS", blocked: false, canUndo: false });
  });

  it("exposes a catalog entry", () => {
    expect(game.catalogEntry).toMatchObject({
      gameId: "toy-game",
      path: "/toy",
      source: "CORE",
      latestVersion: 1,
    });
    expect(game.catalogEntry.options.map((option) => option.name)).toEqual(["mode", "size"]);
  });
});

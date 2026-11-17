import { describe, expect, it } from "vitest";
import { readStats, recordResult, variantKey } from "../../../src/services/memory/memoryStats";
import { createMemoryStore } from "../../../src/services/memory/memoryStore";

const result = (won: boolean, score: number, moves: number) => ({
  gameId: "spider-solitaire",
  options: { suits: 1, dealStyle: "MICROSOFT" },
  won,
  score,
  moves,
  at: "2026-12-02T14:00:00.000Z",
});

describe("memory stats", () => {
  it("builds variant keys from sorted options", () => {
    expect(variantKey({ suits: 1, dealStyle: "MICROSOFT" })).toBe("dealStyle=MICROSOFT;suits=1");
  });

  it("starts empty and ignores corrupt data", () => {
    const store = createMemoryStore(null);
    expect(readStats(store)).toEqual({ stats: [] });
    store.write("allplay.memory.stats", { stats: [{ gameId: 1 }] });
    expect(readStats(store)).toEqual({ stats: [] });
  });

  it("counts wins, losses, streaks, best score and fastest win", () => {
    const store = createMemoryStore(null);
    recordResult(store, result(true, 900, 150));
    recordResult(store, result(true, 1100, 120));
    recordResult(store, result(false, 400, 80));
    recordResult(store, result(true, 1000, 130));
    expect(readStats(store).stats).toEqual([
      {
        gameId: "spider-solitaire",
        variantKey: "dealStyle=MICROSOFT;suits=1",
        gamesPlayed: 4,
        gamesWon: 3,
        gamesLost: 1,
        bestScore: 1100,
        fastestWinMoves: 120,
        currentWinStreak: 1,
        longestWinStreak: 2,
        totalMoves: 480,
        lastPlayedAt: "2026-12-02T14:00:00.000Z",
      },
    ]);
  });

  it("keeps a first loss free of best scores", () => {
    const store = createMemoryStore(null);
    recordResult(store, result(false, 400, 80));
    expect(readStats(store).stats[0]).toMatchObject({
      bestScore: null,
      fastestWinMoves: null,
      gamesLost: 1,
    });
  });
});

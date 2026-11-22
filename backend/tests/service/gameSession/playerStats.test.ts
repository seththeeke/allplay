import { describe, expect, it } from "vitest";
import {
  combineStats,
  foldResult,
  toStatsEntry,
  type GameResult,
} from "../../../src/service/gameSession/playerStats";

const result = (won: boolean, score: number, moves: number, at: string): GameResult => ({
  playerId: "GUEST#g",
  gameId: "spider-solitaire",
  variantKey: "suits=1",
  won,
  score,
  moves,
  at,
  ttl: 99,
});

describe("stats folding", () => {
  it("counts wins and losses, keeps the best results, and resets the streak on a loss", () => {
    const first = foldResult(null, result(true, 900, 120, "2026-11-01T00:00:00.000Z"));
    expect(first).toMatchObject({
      statsKey: "spider-solitaire#suits=1",
      gamesPlayed: 1,
      gamesWon: 1,
      bestScore: 900,
      fastestWinMoves: 120,
      currentWinStreak: 1,
      longestWinStreak: 1,
      totalMoves: 120,
      version: 1,
      ttl: 99,
      createdAt: "2026-11-01T00:00:00.000Z",
    });
    const second = foldResult(first, result(true, 800, 100, "2026-11-02T00:00:00.000Z"));
    expect(second).toMatchObject({ bestScore: 900, fastestWinMoves: 100, currentWinStreak: 2 });
    const third = foldResult(second, {
      ...result(false, 300, 40, "2026-11-03T00:00:00.000Z"),
      ttl: undefined,
    });
    expect(third).toMatchObject({
      gamesPlayed: 3,
      gamesWon: 2,
      gamesLost: 1,
      bestScore: 900,
      fastestWinMoves: 100,
      currentWinStreak: 0,
      longestWinStreak: 2,
      totalMoves: 260,
      lastPlayedAt: "2026-11-03T00:00:00.000Z",
      version: 3,
      createdAt: "2026-11-01T00:00:00.000Z",
    });
    expect(third.ttl).toBeUndefined();
    const loss = foldResult(null, result(false, 450, 50, "2026-11-01T00:00:00.000Z"));
    expect(loss).toMatchObject({ bestScore: null, fastestWinMoves: null, gamesLost: 1 });
  });

  it("combines a guest's item into an account's, without a ttl", () => {
    const guest = foldResult(
      foldResult(null, result(true, 950, 90, "2026-11-05T00:00:00.000Z")),
      result(true, 700, 130, "2026-11-06T00:00:00.000Z"),
    );
    const moved = combineStats(null, guest, "ACCT#a", "2026-11-07T00:00:00.000Z");
    expect(moved).toMatchObject({ playerId: "ACCT#a", gamesWon: 2, version: 1 });
    expect(moved.ttl).toBeUndefined();
    const account = foldResult(null, {
      ...result(false, 200, 30, "2026-11-01T00:00:00.000Z"),
      playerId: "ACCT#a",
      ttl: undefined,
    });
    expect(combineStats(account, guest, "ACCT#a", "2026-11-07T00:00:00.000Z")).toMatchObject({
      gamesPlayed: 3,
      gamesWon: 2,
      gamesLost: 1,
      bestScore: 950,
      fastestWinMoves: 90,
      currentWinStreak: 2,
      longestWinStreak: 2,
      totalMoves: 250,
      lastPlayedAt: "2026-11-06T00:00:00.000Z",
      version: 2,
    });
    /* The streak follows whichever player played last. */
    expect(combineStats(guest, account, "GUEST#g", "2026-11-07T00:00:00.000Z")).toMatchObject({
      currentWinStreak: 2,
      lastPlayedAt: "2026-11-06T00:00:00.000Z",
    });
    expect(toStatsEntry(account)).toEqual({
      gameId: "spider-solitaire",
      variantKey: "suits=1",
      gamesPlayed: 1,
      gamesWon: 0,
      gamesLost: 1,
      bestScore: null,
      fastestWinMoves: null,
      currentWinStreak: 0,
      longestWinStreak: 0,
      totalMoves: 30,
      lastPlayedAt: "2026-11-01T00:00:00.000Z",
    });
  });
});

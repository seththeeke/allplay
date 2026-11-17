import { StatsResponseSchema, type StatsEntry, type StatsResponse } from "../../models/api";
import type { MemoryStore } from "./memoryStore";

const KEY = "allplay.memory.stats";

export interface GameResult {
  gameId: string;
  options: Record<string, string | number | boolean>;
  won: boolean;
  score: number;
  moves: number;
  at: string;
}

/** Stable form of the options used to group statistics (game-engine.md section 4.1). */
export function variantKey(options: GameResult["options"]): string {
  return Object.keys(options)
    .sort()
    .map((name) => `${name}=${String(options[name])}`)
    .join(";");
}

export function readStats(store: MemoryStore): StatsResponse {
  const parsed = StatsResponseSchema.safeParse(store.read<unknown>(KEY, null));
  return parsed.success ? parsed.data : { stats: [] };
}

/** Folds one finished game into the player's statistics (data-model.md section 8). */
export function recordResult(store: MemoryStore, result: GameResult): void {
  const { stats } = readStats(store);
  const key = variantKey(result.options);
  const current: StatsEntry = stats.find(
    (entry) => entry.gameId === result.gameId && entry.variantKey === key,
  ) ?? {
    gameId: result.gameId,
    variantKey: key,
    gamesPlayed: 0,
    gamesWon: 0,
    gamesLost: 0,
    bestScore: null,
    fastestWinMoves: null,
    currentWinStreak: 0,
    longestWinStreak: 0,
    totalMoves: 0,
    lastPlayedAt: null,
  };
  const streak = result.won ? current.currentWinStreak + 1 : 0;
  const next: StatsEntry = {
    ...current,
    gamesPlayed: current.gamesPlayed + 1,
    gamesWon: current.gamesWon + (result.won ? 1 : 0),
    gamesLost: current.gamesLost + (result.won ? 0 : 1),
    bestScore: result.won
      ? Math.max(current.bestScore ?? result.score, result.score)
      : current.bestScore,
    fastestWinMoves: result.won
      ? Math.min(current.fastestWinMoves ?? result.moves, result.moves)
      : current.fastestWinMoves,
    currentWinStreak: streak,
    longestWinStreak: Math.max(current.longestWinStreak, streak),
    totalMoves: current.totalMoves + result.moves,
    lastPlayedAt: result.at,
  };
  store.write(KEY, { stats: [...stats.filter((entry) => entry !== current), next] });
}

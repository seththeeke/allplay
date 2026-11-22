import type { StatsEntry } from "../../models/api";
import { statsKeyOf, type PlayerStats } from "../../models/playerStats";

/** One ended session as statistics see it (data-model.md section 8). */
export interface GameResult {
  playerId: string;
  gameId: string;
  variantKey: string;
  won: boolean;
  score: number;
  moves: number;
  at: string;
  ttl?: number | undefined;
}

const zeros = (result: GameResult): PlayerStats => ({
  playerId: result.playerId,
  statsKey: statsKeyOf(result.gameId, result.variantKey),
  gameId: result.gameId,
  variantKey: result.variantKey,
  gamesPlayed: 0,
  gamesWon: 0,
  gamesLost: 0,
  bestScore: null,
  fastestWinMoves: null,
  currentWinStreak: 0,
  longestWinStreak: 0,
  totalMoves: 0,
  lastPlayedAt: result.at,
  version: 0,
  entityVersion: 1,
  createdAt: result.at,
  updatedAt: result.at,
});

const withoutTtl = (item: PlayerStats): PlayerStats => {
  const copy = { ...item };
  delete copy.ttl;
  return copy;
};

const higher = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : Math.max(a, b);
const lower = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : Math.min(a, b);

/** Folds one result into the player's item for its variant, or into zeros (data-model.md section 8). */
export function foldResult(current: PlayerStats | null, result: GameResult): PlayerStats {
  const base = current ?? zeros(result);
  const streak = result.won ? base.currentWinStreak + 1 : 0;
  return {
    ...withoutTtl(base),
    gamesPlayed: base.gamesPlayed + 1,
    gamesWon: base.gamesWon + (result.won ? 1 : 0),
    gamesLost: base.gamesLost + (result.won ? 0 : 1),
    bestScore: result.won ? higher(base.bestScore, result.score) : base.bestScore,
    fastestWinMoves: result.won ? lower(base.fastestWinMoves, result.moves) : base.fastestWinMoves,
    currentWinStreak: streak,
    longestWinStreak: Math.max(base.longestWinStreak, streak),
    totalMoves: base.totalMoves + result.moves,
    lastPlayedAt: result.at,
    version: base.version + 1,
    ...(result.ttl === undefined ? {} : { ttl: result.ttl }),
    updatedAt: result.at,
  };
}

/**
 * A merged player's item for one variant (data-model.md section 9, step 3):
 * counts summed, best values compared, the streak from the item played last.
 * The result belongs to `into`'s player and carries no ttl, as account items do not.
 */
export function combineStats(
  into: PlayerStats | null,
  from: PlayerStats,
  intoPlayerId: string,
  at: string,
): PlayerStats {
  if (into === null)
    return {
      ...withoutTtl(from),
      playerId: intoPlayerId,
      version: 1,
      createdAt: at,
      updatedAt: at,
    };
  const latest = from.lastPlayedAt > into.lastPlayedAt ? from : into;
  return {
    ...into,
    gamesPlayed: into.gamesPlayed + from.gamesPlayed,
    gamesWon: into.gamesWon + from.gamesWon,
    gamesLost: into.gamesLost + from.gamesLost,
    bestScore: higher(into.bestScore, from.bestScore),
    fastestWinMoves: lower(into.fastestWinMoves, from.fastestWinMoves),
    currentWinStreak: latest.currentWinStreak,
    longestWinStreak: Math.max(into.longestWinStreak, from.longestWinStreak),
    totalMoves: into.totalMoves + from.totalMoves,
    lastPlayedAt: latest.lastPlayedAt,
    version: into.version + 1,
    updatedAt: at,
  };
}

/** The API shape of a stats item (`GET /v1/players/me/stats`). */
export function toStatsEntry(item: PlayerStats): StatsEntry {
  return {
    gameId: item.gameId,
    variantKey: item.variantKey,
    gamesPlayed: item.gamesPlayed,
    gamesWon: item.gamesWon,
    gamesLost: item.gamesLost,
    bestScore: item.bestScore,
    fastestWinMoves: item.fastestWinMoves,
    currentWinStreak: item.currentWinStreak,
    longestWinStreak: item.longestWinStreak,
    totalMoves: item.totalMoves,
    lastPlayedAt: item.lastPlayedAt,
  };
}

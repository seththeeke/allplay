import type { PlayerDao } from "../../dao/player/playerDao";
import {
  limitMessage,
  type GameAllowance,
  type GameLimit,
  type LimitPeriod,
} from "../../models/api";
import type { GamesPlayed } from "../../models/gamesPlayed";
import { guestTtl, type Player } from "../../models/player";
import { GameSessionError } from "../gameSession/errors";

/** A stage's default limit as written in its settings: `5/DAY` or `UNLIMITED` (productionalization.md section 2). */
export function parseGameLimit(text: string | undefined): GameLimit {
  const match = /^(\d+)\/(DAY|WEEK|MONTH)$/.exec(text ?? "");
  if (match === null) return { unlimited: true };
  return { count: Number(match[1]), period: match[2] as LimitPeriod };
}

/** The UTC window `at` falls in: the day, the ISO week from Monday, or the month, and when the next begins. */
export function windowOf(period: LimitPeriod, at: Date): { windowStart: string; resetsAt: string } {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  if (period === "WEEK") start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  if (period === "MONTH") start.setUTCDate(1);
  const next = new Date(start);
  if (period === "DAY") next.setUTCDate(next.getUTCDate() + 1);
  if (period === "WEEK") next.setUTCDate(next.getUTCDate() + 7);
  if (period === "MONTH") next.setUTCMonth(next.getUTCMonth() + 1);
  return { windowStart: start.toISOString().slice(0, 10), resetsAt: next.toISOString() };
}

/** A window a counted game belongs to, so a failed start can give it back. */
export type CountedWindow = Pick<GamesPlayed, "period" | "windowStart">;

/** Per-player game limits (productionalization.md section 5). */
export interface GameAllowanceService {
  /** The player's limit and use in the current window. */
  allowance(player: Player | null): GameAllowance;
  /** Counts a game the player is starting; throws 429 GAME_LIMIT_REACHED when none are left. */
  consume(playerId: string): Promise<CountedWindow>;
  /** Gives back a game whose session was not written. */
  giveBack(playerId: string, window: CountedWindow): Promise<void>;
}

export interface GameAllowanceDeps {
  players: Pick<PlayerDao, "get" | "countGame" | "giveBackGame">;
  defaultLimit: GameLimit;
  now?: () => Date;
}

/** A player item for a caller the table has not seen, so a first game can be counted. */
function seedPlayer(playerId: string, at: Date): Player {
  const stamp = at.toISOString();
  const guest = playerId.startsWith("GUEST#");
  return {
    playerId,
    kind: guest ? "GUEST" : "ACCOUNT",
    status: "ACTIVE",
    identityIds: guest ? [playerId.slice("GUEST#".length)] : [],
    firstSeenAt: stamp,
    lastActiveAt: stamp,
    ...(guest ? { ttl: guestTtl(at) } : {}),
    entityVersion: 1,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

export function createGameAllowanceService(deps: GameAllowanceDeps): GameAllowanceService {
  const now = deps.now ?? (() => new Date());
  const limitOf = (player: Player | null): GameLimit => player?.gameLimit ?? deps.defaultLimit;
  /* An unlimited player is still counted by the day, so admins see their use. */
  const periodOf = (limit: GameLimit): LimitPeriod => ("period" in limit ? limit.period : "DAY");
  return {
    allowance: (player) => {
      const limit = limitOf(player);
      const period = periodOf(limit);
      const { windowStart, resetsAt } = windowOf(period, now());
      const stored = player?.gamesPlayed;
      const used =
        stored?.period === period && stored.windowStart === windowStart ? stored.count : 0;
      if (!("count" in limit)) return { limit: null, period: null, used, resetsAt: null };
      return { limit: limit.count, period, used, resetsAt };
    },
    consume: async (playerId) => {
      const at = now();
      const limit = limitOf(await deps.players.get(playerId));
      const period = periodOf(limit);
      const { windowStart, resetsAt } = windowOf(period, at);
      const window = { period, windowStart };
      const cap = "count" in limit ? limit.count : null;
      const counted = await deps.players.countGame(
        playerId,
        window,
        cap,
        at.toISOString(),
        seedPlayer(playerId, at),
      );
      if (counted === null)
        throw new GameSessionError(
          429,
          "GAME_LIMIT_REACHED",
          limitMessage(cap ?? 0, period),
          undefined,
          { limit: cap ?? 0, period, resetsAt },
        );
      return window;
    },
    giveBack: (playerId, window) =>
      deps.players.giveBackGame(playerId, window, now().toISOString()),
  };
}

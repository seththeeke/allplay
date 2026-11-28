import type { GamesPlayed } from "../../models/gamesPlayed";
import type { Player } from "../../models/player";

export class PlayerExistsError extends Error {
  override readonly name = "PlayerExistsError";
}

export class PlayerMissingError extends Error {
  override readonly name = "PlayerMissingError";
}

/** Fields an update may set; the key, kind, creation fields and schema version never change. */
export type PlayerChanges = Partial<
  Omit<Player, "playerId" | "kind" | "entityVersion" | "createdAt" | "updatedAt" | "firstSeenAt">
>;

/** What the `ByEmail` index projects (data-model.md section 4). */
export interface EmailMatch {
  playerId: string;
  status: Player["status"];
  signInProviders: NonNullable<Player["signInProviders"]>;
  createdAt: string;
}

/** An account on the `ByEmail` index with its key. */
export interface EmailEntry extends EmailMatch {
  emailKey: string;
}

/** `lastActiveAt` moves at most this often (data-model.md section 4). */
export const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Player persistence (data-model.md section 4). The in-memory and DynamoDB
 * implementations share one contract test, run in unit tests against memory
 * and in the Test stage's integration tests against DynamoDB.
 */
export interface PlayerDao {
  get(playerId: string): Promise<Player | null>;
  /** Writes a new player; throws PlayerExistsError when the id is taken. */
  create(player: Player): Promise<void>;
  /** Sets `changes`, removes `remove`, stamps `updatedAt`; throws PlayerMissingError. Returns the stored player. */
  update(
    playerId: string,
    changes: PlayerChanges,
    at: string,
    remove?: readonly (keyof PlayerChanges)[],
  ): Promise<Player>;
  /**
   * Moves `lastActiveAt` (and `ttl` for a guest) to `at` when the stored value
   * is at least an hour old. Returns false when nothing was written.
   */
  touch(playerId: string, at: Date, ttl?: number): Promise<boolean>;
  /** Accounts whose normalized email is `emailKey`, oldest first (`ByEmail`). */
  listByEmail(emailKey: string): Promise<EmailMatch[]>;
  /** Every account with an email, for the admin duplicate list (a scan of `ByEmail`). */
  listAllEmails(): Promise<EmailEntry[]>;
  /**
   * Counts one started game in the window (productionalization.md section 5)
   * with one conditional write: a stored count of another window restarts at
   * 1, and a count already at `limit` is refused (null). A missing player is
   * created from `seed`. `limit` null counts without a cap.
   */
  countGame(
    playerId: string,
    window: Pick<GamesPlayed, "period" | "windowStart">,
    limit: number | null,
    at: string,
    seed: Player,
  ): Promise<GamesPlayed | null>;
  /** Takes back one game counted in the window, when the session it was for was not written. */
  giveBackGame(
    playerId: string,
    window: Pick<GamesPlayed, "period" | "windowStart">,
    at: string,
  ): Promise<void>;
  /** Every player's counting fields, for the daily rollup's one scan (data-model.md section 11). */
  listForRollup(): Promise<RollupPlayer[]>;
}

/** The fields the daily rollup counts. */
export interface RollupPlayer {
  kind: Player["kind"];
  status: Player["status"];
  lastActiveAt: string;
  createdAt: string;
}

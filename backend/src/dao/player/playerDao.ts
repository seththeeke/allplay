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
}

import type { PlayerStats } from "../../models/playerStats";

/** A stats write's version condition failed: the item changed since it was read. */
export class StatsVersionConflictError extends Error {
  override readonly name = "StatsVersionConflictError";
}

/** The version a stats write expects: the version read, or null when no item exists yet. */
export interface StatsWrite {
  item: PlayerStats;
  expectedVersion: number | null;
}

/**
 * PlayerStats persistence (data-model.md section 8). A game's result is
 * written by the session DAO's end transaction; `moveInto` serves the merge.
 */
export interface PlayerStatsDao {
  get(playerId: string, statsKey: string): Promise<PlayerStats | null>;
  list(playerId: string): Promise<PlayerStats[]>;
  /**
   * Writes the combined item and deletes the source item in one transaction,
   * so a retried merge never counts a guest's games twice (data-model.md section 10).
   */
  moveInto(write: StatsWrite, from: { playerId: string; statsKey: string }): Promise<void>;
  delete(playerId: string, statsKey: string): Promise<void>;
}

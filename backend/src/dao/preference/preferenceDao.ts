import type { Preference, PreferenceValues } from "../../models/preference";

/**
 * Preference persistence (data-model.md section 5): one item per player and
 * scope, written field by field so concurrent changes to different fields
 * never overwrite each other.
 */
export interface PreferenceDao {
  /** Every scope of a player (one Query on the partition). */
  list(playerId: string): Promise<Preference[]>;
  /**
   * Sets the given fields of one scope, creating the item if needed, and
   * stamps `updatedAt`. A guest's `ttl` is set when given.
   */
  patch(
    playerId: string,
    scope: string,
    values: PreferenceValues,
    at: string,
    ttl?: number,
  ): Promise<Preference>;
}

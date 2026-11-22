import { PlayerStatsSchema, type PlayerStats } from "../../models/playerStats";
import { StatsVersionConflictError, type PlayerStatsDao, type StatsWrite } from "./playerStatsDao";

/** The map key of a stats item, shared with the in-memory session DAO's transactions. */
export const statsItemKey = (playerId: string, statsKey: string): string =>
  `${playerId}|${statsKey}`;

/** Throws StatsVersionConflictError unless the stored item is at the write's expected version. */
export function checkStatsWrite(items: Map<string, PlayerStats>, write: StatsWrite): void {
  const stored = items.get(statsItemKey(write.item.playerId, write.item.statsKey));
  if ((stored?.version ?? null) !== write.expectedVersion)
    throw new StatsVersionConflictError(write.item.statsKey);
}

/** Parses and copies a stats item into the map, as a DynamoDB write would store it. */
export function storeStats(items: Map<string, PlayerStats>, item: PlayerStats): void {
  items.set(
    statsItemKey(item.playerId, item.statsKey),
    structuredClone(PlayerStatsSchema.parse(item)),
  );
}

/** PlayerStatsDao over a map; items pass the schema and reads return copies. */
export function createInMemoryPlayerStatsDao(
  items: Map<string, PlayerStats> = new Map(),
): PlayerStatsDao {
  const run = <T>(work: () => T): Promise<T> =>
    new Promise((resolve) => {
      resolve(work());
    });
  return {
    get: (playerId, statsKey) =>
      run(() => {
        const item = items.get(statsItemKey(playerId, statsKey));
        return item === undefined ? null : structuredClone(item);
      }),
    list: (playerId) =>
      run(() =>
        [...items.values()]
          .filter((item) => item.playerId === playerId)
          .sort((a, b) => a.statsKey.localeCompare(b.statsKey))
          .map((item) => structuredClone(item)),
      ),
    moveInto: (write, from) =>
      run(() => {
        checkStatsWrite(items, write);
        storeStats(items, write.item);
        items.delete(statsItemKey(from.playerId, from.statsKey));
      }),
    delete: (playerId, statsKey) =>
      run(() => {
        items.delete(statsItemKey(playerId, statsKey));
      }),
  };
}

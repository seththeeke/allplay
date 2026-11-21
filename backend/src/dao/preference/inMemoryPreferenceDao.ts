import { PreferenceSchema, type Preference } from "../../models/preference";
import type { PreferenceDao } from "./preferenceDao";

/** PreferenceDao over a map keyed by player and scope; items pass the schema and reads return copies. */
export function createInMemoryPreferenceDao(): PreferenceDao {
  const items = new Map<string, Preference>();
  const run = <T>(work: () => T): Promise<T> =>
    new Promise((resolve) => {
      resolve(work());
    });
  return {
    list: (playerId) =>
      run(() =>
        [...items.values()]
          .filter((item) => item.playerId === playerId)
          .sort((a, b) => a.scope.localeCompare(b.scope))
          .map((item) => structuredClone(item)),
      ),
    deleteAll: (playerId) =>
      run(() => {
        for (const [key, item] of items) if (item.playerId === playerId) items.delete(key);
      }),
    patch: (playerId, scope, values, at, ttl) =>
      run(() => {
        const key = `${playerId}|${scope}`;
        const current = items.get(key);
        const next = PreferenceSchema.parse({
          ...(current ?? { playerId, scope, entityVersion: 1, createdAt: at }),
          ...values,
          updatedAt: at,
          ...(ttl === undefined ? {} : { ttl }),
        });
        items.set(key, structuredClone(next));
        return structuredClone(next);
      }),
  };
}

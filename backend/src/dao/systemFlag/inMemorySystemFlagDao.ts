import { SystemFlagSchema, type SystemFlag } from "../../models/systemFlag";
import type { SystemFlagDao } from "./systemFlagDao";

/** SystemFlagDao over a map; reads return copies. */
export function createInMemorySystemFlagDao(): SystemFlagDao {
  const items = new Map<string, SystemFlag>();
  return {
    get: (flagId) => {
      const item = items.get(flagId);
      return Promise.resolve(item === undefined ? null : structuredClone(item));
    },
    put: (flag) => {
      const parsed = SystemFlagSchema.parse(flag);
      const stored = {
        ...parsed,
        createdAt: items.get(flag.flagId)?.createdAt ?? parsed.createdAt,
      };
      items.set(flag.flagId, stored);
      return Promise.resolve(structuredClone(stored));
    },
  };
}

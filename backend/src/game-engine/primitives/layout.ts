import type { ZoneType } from "../rules/schema";
import type { ZoneRef } from "../types";

/** Zone instances derived from the rules' zone types (game-engine.md section 4.4). */
export interface GameLayout {
  zoneTypes: ReadonlyMap<string, ZoneType>;
  zoneIdsByType: ReadonlyMap<string, readonly string[]>;
  zoneIds: ReadonlySet<string>;
  /** Every zone id in declaration order, then index order. */
  order: readonly string[];
  refs: ReadonlyMap<string, ZoneRef>;
}

export function buildLayout(types: readonly ZoneType[]): GameLayout {
  const zoneTypes = new Map<string, ZoneType>();
  const zoneIdsByType = new Map<string, string[]>();
  const refs = new Map<string, ZoneRef>();
  const order: string[] = [];
  for (const zoneType of types) {
    zoneTypes.set(zoneType.type, zoneType);
    const ids: string[] = [];
    for (let index = 1; index <= zoneType.count; index += 1) {
      const zoneId = `${zoneType.type}.${String(index)}`;
      ids.push(zoneId);
      order.push(zoneId);
      const label = zoneType.label.numbered
        ? `${zoneType.label.singular} ${String(index)}`
        : zoneType.label.singular;
      refs.set(zoneId, { zoneId, type: zoneType.type, index, label });
    }
    zoneIdsByType.set(zoneType.type, ids);
  }
  return { zoneTypes, zoneIdsByType, zoneIds: new Set(order), order, refs };
}

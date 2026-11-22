import { emptyDay, MetricRollupSchema, type MetricRollup } from "../../models/metricRollup";
import type { MetricRollupDao } from "./metricRollupDao";

/** MetricRollupDao over a map; items pass the schema and reads return copies. */
export function createInMemoryMetricRollupDao(): MetricRollupDao {
  const items = new Map<string, MetricRollup>();
  const run = <T>(work: () => T): Promise<T> =>
    new Promise((resolve) => {
      resolve(work());
    });
  const day = (period: string, at: string): MetricRollup => {
    const current = items.get(period) ?? emptyDay(period, at);
    items.set(period, current);
    return current;
  };
  return {
    add: (period, increments, at) =>
      run(() => {
        const item = day(period, at);
        const empty =
          Object.keys(increments.counters ?? {}).length === 0 &&
          Object.values(increments.maps ?? {}).every((map) => Object.keys(map).length === 0);
        if (empty) return;
        for (const [name, value] of Object.entries(increments.counters ?? {}))
          item[name as keyof NonNullable<typeof increments.counters>] += value;
        for (const [name, entries] of Object.entries(increments.maps ?? {})) {
          const map = item[name as keyof NonNullable<typeof increments.maps>] as Record<
            string,
            number
          >;
          for (const [key, value] of Object.entries(entries)) map[key] = (map[key] ?? 0) + value;
        }
        item.updatedAt = at;
        MetricRollupSchema.parse(item);
      }),
    setTotals: (period, totals, at) =>
      run(() => {
        Object.assign(day(period, at), totals, { updatedAt: at });
      }),
    get: (period) =>
      run(() => {
        const item = items.get(period);
        return item === undefined ? null : structuredClone(item);
      }),
    range: (from, to) =>
      run(() =>
        [...items.values()]
          .filter((item) => item.period >= from && item.period <= to)
          .sort((a, b) => a.period.localeCompare(b.period))
          .map((item) => structuredClone(item)),
      ),
  };
}

import type { MetricIncrements, MetricRollup, RollupTotals } from "../../models/metricRollup";

/** MetricRollup persistence (data-model.md section 11). */
export interface MetricRollupDao {
  /** Adds to the day's counters, creating the day empty first when it is missing. */
  add(period: string, increments: MetricIncrements, at: string): Promise<void>;
  /** Writes the rollup job's totals and percentiles onto the day. */
  setTotals(period: string, totals: RollupTotals, at: string): Promise<void>;
  get(period: string): Promise<MetricRollup | null>;
  /** Days from `from` to `to` inclusive, oldest first. */
  range(from: string, to: string): Promise<MetricRollup[]>;
}

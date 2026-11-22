import { LATENCY_BOUNDS, type MetricRollup } from "../../models/metricRollup";

/**
 * A percentile from a latency histogram (data-model.md section 11), placed
 * linearly within its bucket; the overflow bucket reads as its lower bound.
 * Null when the histogram is empty.
 */
export function percentile(
  buckets: MetricRollup["clientLatencyBuckets"],
  quantile: number,
): number | null {
  const counts = [
    ...LATENCY_BOUNDS.map((bound) => buckets[`le${String(bound)}` as keyof typeof buckets]),
    buckets.overflow,
  ];
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total === 0) return null;
  const target = quantile * total;
  let before = 0;
  for (const [index, count] of counts.entries()) {
    const lower = index === 0 ? 0 : (LATENCY_BOUNDS[index - 1] ?? 0);
    const upper = LATENCY_BOUNDS[index];
    if (upper === undefined) return lower;
    if (before + count >= target && count > 0)
      return Math.round(lower + ((upper - lower) * (target - before)) / count);
    before += count;
  }
  return LATENCY_BOUNDS[LATENCY_BOUNDS.length - 1] ?? 0;
}

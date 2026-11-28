import { z } from "zod";
import { LatencyBucketsSchema } from "./api";

const Counts = z.record(z.string(), z.number().int().min(0));
const Percentile = z.number().int().min(0).nullable().optional();

/**
 * Every latency histogram (productionalization.md section 7). The first two
 * date from day 0; the others are absent on days written before PZ-6.
 */
export const LATENCY_HISTOGRAMS = [
  "clientLatency",
  "serverLatency",
  "llmLatency",
  "transcribeLatency",
  "pollyLatency",
  "moveLatency",
] as const;
export type LatencyHistogram = (typeof LATENCY_HISTOGRAMS)[number];

/** One day's aggregates for /admin (data-model.md section 11). */
export const MetricRollupSchema = z.object({
  rollupType: z.literal("DAY"),
  period: z.iso.date(),
  totalPlayers: z.number().int().min(0).optional(),
  totalAccounts: z.number().int().min(0).optional(),
  totalGuests: z.number().int().min(0).optional(),
  activePlayers30d: z.number().int().min(0).optional(),
  newPlayers: z.number().int().min(0).optional(),
  gamesStarted: Counts,
  gamesWon: Counts,
  gamesAbandoned: Counts,
  decisions: z.number().int().min(0),
  decisionOutcomes: Counts,
  hardFailures: z.number().int().min(0),
  softFailures: z.number().int().min(0),
  llmCalls: z.number().int().min(0),
  llmInputTokens: z.number().int().min(0),
  llmOutputTokens: z.number().int().min(0),
  clientLatencyBuckets: LatencyBucketsSchema,
  serverLatencyBuckets: LatencyBucketsSchema,
  llmLatencyBuckets: LatencyBucketsSchema.optional(),
  transcribeLatencyBuckets: LatencyBucketsSchema.optional(),
  pollyLatencyBuckets: LatencyBucketsSchema.optional(),
  moveLatencyBuckets: LatencyBucketsSchema.optional(),
  clientLatencyP50Ms: Percentile,
  clientLatencyP95Ms: Percentile,
  serverLatencyP50Ms: Percentile,
  serverLatencyP95Ms: Percentile,
  llmLatencyP50Ms: Percentile,
  llmLatencyP95Ms: Percentile,
  transcribeLatencyP50Ms: Percentile,
  transcribeLatencyP95Ms: Percentile,
  pollyLatencyP50Ms: Percentile,
  pollyLatencyP95Ms: Percentile,
  moveLatencyP50Ms: Percentile,
  moveLatencyP95Ms: Percentile,
  entityVersion: z.literal(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type MetricRollup = z.infer<typeof MetricRollupSchema>;

/** Histogram upper bounds in milliseconds; a larger value falls in `overflow` (data-model.md section 11). */
export const LATENCY_BOUNDS = [250, 500, 750, 1000, 1500, 2000, 3000, 5000] as const;

/** The bucket a latency falls in. */
export function latencyBucket(ms: number): keyof MetricRollup["clientLatencyBuckets"] {
  const bound = LATENCY_BOUNDS.find((upper) => ms <= upper);
  return bound === undefined
    ? "overflow"
    : (`le${String(bound)}` as keyof MetricRollup["clientLatencyBuckets"]);
}

/** Increments to add to a day: top-level counters, and counters inside a map by key. */
export interface MetricIncrements {
  counters?: Partial<
    Record<
      | "decisions"
      | "hardFailures"
      | "softFailures"
      | "llmCalls"
      | "llmInputTokens"
      | "llmOutputTokens",
      number
    >
  >;
  maps?: Partial<
    Record<
      | "gamesStarted"
      | "gamesWon"
      | "gamesAbandoned"
      | "decisionOutcomes"
      | `${LatencyHistogram}Buckets`,
      Record<string, number>
    >
  >;
}

/** What the daily rollup job writes over the day's counters. */
export type RollupTotals = Pick<
  MetricRollup,
  | "totalPlayers"
  | "totalAccounts"
  | "totalGuests"
  | "activePlayers30d"
  | "newPlayers"
  | `${LatencyHistogram}P50Ms`
  | `${LatencyHistogram}P95Ms`
>;

/** An all-zero histogram. */
export function emptyBuckets(): MetricRollup["clientLatencyBuckets"] {
  return Object.fromEntries(
    [...LATENCY_BOUNDS.map((bound) => `le${String(bound)}`), "overflow"].map((key) => [key, 0]),
  ) as MetricRollup["clientLatencyBuckets"];
}

/** An empty day, written once before the first increment. */
export function emptyDay(period: string, at: string): MetricRollup {
  return {
    rollupType: "DAY",
    period,
    gamesStarted: {},
    gamesWon: {},
    gamesAbandoned: {},
    decisions: 0,
    decisionOutcomes: {},
    hardFailures: 0,
    softFailures: 0,
    llmCalls: 0,
    llmInputTokens: 0,
    llmOutputTokens: 0,
    clientLatencyBuckets: emptyBuckets(),
    serverLatencyBuckets: emptyBuckets(),
    llmLatencyBuckets: emptyBuckets(),
    transcribeLatencyBuckets: emptyBuckets(),
    pollyLatencyBuckets: emptyBuckets(),
    moveLatencyBuckets: emptyBuckets(),
    entityVersion: 1,
    createdAt: at,
    updatedAt: at,
  };
}

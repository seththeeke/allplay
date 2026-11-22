import { z } from "zod";
import { LatencyBucketsSchema } from "./api";

const Counts = z.record(z.string(), z.number().int().min(0));

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
  clientLatencyP50Ms: z.number().int().min(0).nullable().optional(),
  clientLatencyP95Ms: z.number().int().min(0).nullable().optional(),
  serverLatencyP50Ms: z.number().int().min(0).nullable().optional(),
  serverLatencyP95Ms: z.number().int().min(0).nullable().optional(),
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
      | "clientLatencyBuckets"
      | "serverLatencyBuckets",
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
  | "clientLatencyP50Ms"
  | "clientLatencyP95Ms"
  | "serverLatencyP50Ms"
  | "serverLatencyP95Ms"
>;

/** An empty day, written once before the first increment. */
export function emptyDay(period: string, at: string): MetricRollup {
  const buckets = Object.fromEntries(
    [...LATENCY_BOUNDS.map((bound) => `le${String(bound)}`), "overflow"].map((key) => [key, 0]),
  ) as MetricRollup["clientLatencyBuckets"];
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
    clientLatencyBuckets: buckets,
    serverLatencyBuckets: { ...buckets },
    entityVersion: 1,
    createdAt: at,
    updatedAt: at,
  };
}

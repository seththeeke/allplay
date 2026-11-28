import { createDynamoMetricRollupDao } from "../../dao/metricRollup/dynamoMetricRollupDao";
import type { MetricRollupDao } from "../../dao/metricRollup/metricRollupDao";
import type { Logger } from "../../logger";
import {
  latencyBucket,
  type LatencyHistogram,
  type MetricIncrements,
} from "../../models/metricRollup";
import type { Decision } from "../../models/decision";
import type { TurnLog, TurnResolved } from "../decision/turnLog";

/** Live counters on the day's `MetricRollup` (data-model.md section 11, writer 1). */
export interface MetricsRecorder {
  gameStarted(gameId: string): Promise<void>;
  gameEnded(gameId: string, status: "WON" | "ABANDONED"): Promise<void>;
  turnDecided(turn: Decision): Promise<void>;
  turnResolved(event: TurnResolved): Promise<void>;
  /** Adds latency samples to their histograms in one write (productionalization.md section 7). */
  latencies(samples: readonly { histogram: LatencyHistogram; ms: number }[]): Promise<void>;
}

/** Bucket counts for a set of samples, by histogram. */
export function latencyIncrements(
  samples: readonly { histogram: LatencyHistogram; ms: number }[],
): MetricIncrements {
  const maps: Record<string, Record<string, number>> = {};
  for (const { histogram, ms } of samples) {
    const map = (maps[`${histogram}Buckets`] ??= {});
    const bucket = latencyBucket(ms);
    map[bucket] = (map[bucket] ?? 0) + 1;
  }
  return { maps: maps };
}

const day = (at: Date) => at.toISOString().slice(0, 10);

/** The increments a final outcome adds: its count and its failure class. */
function outcome(name: string, failureClass: string | undefined): MetricIncrements {
  return {
    counters: {
      ...(failureClass === "HARD" ? { hardFailures: 1 } : {}),
      ...(failureClass === "SOFT" ? { softFailures: 1 } : {}),
    },
    maps: { decisionOutcomes: { [name]: 1 } },
  };
}

const merge = (a: MetricIncrements, b: MetricIncrements): MetricIncrements => ({
  counters: { ...a.counters, ...b.counters },
  maps: { ...a.maps, ...b.maps },
});

/**
 * Counts game starts and ends, turns, outcomes, failures, model calls and
 * tokens, and latency buckets. A failed write is logged and never fails the
 * request it counts.
 */
export function createMetricsRecorder(
  dao: MetricRollupDao,
  logger: Logger,
  now: () => Date = () => new Date(),
): MetricsRecorder {
  const add = async (increments: MetricIncrements) => {
    const at = now();
    try {
      await dao.add(day(at), increments, at.toISOString());
    } catch (error) {
      logger.warn("Metric counters not written", { error: String(error) });
    }
  };
  return {
    gameStarted: (gameId) => add({ maps: { gamesStarted: { [gameId]: 1 } } }),
    gameEnded: (gameId, status) =>
      add({ maps: { [status === "WON" ? "gamesWon" : "gamesAbandoned"]: { [gameId]: 1 } } }),
    turnDecided: (turn) => {
      const calls = [turn.classification, turn.selection].filter((call) => call !== undefined);
      const base: MetricIncrements = {
        counters: {
          decisions: 1,
          llmCalls: calls.length,
          llmInputTokens: calls.reduce((sum, call) => sum + call.inputTokens, 0),
          llmOutputTokens: calls.reduce((sum, call) => sum + call.outputTokens, 0),
        },
        maps: {
          ...latencyIncrements([
            { histogram: "serverLatency", ms: turn.serverLatencyMs },
            ...calls.map((call) => ({ histogram: "llmLatency" as const, ms: call.latencyMs })),
          ]).maps,
        },
      };
      return add(
        turn.failureClass === undefined
          ? base
          : merge(base, outcome(turn.outcome, turn.failureClass)),
      );
    },
    latencies: (samples) =>
      samples.length === 0 ? Promise.resolve() : add(latencyIncrements(samples)),
    turnResolved: (event) => {
      const counted = outcome(event.outcome, event.failureClass);
      return add(
        event.clientLatencyMs === undefined
          ? counted
          : {
              ...counted,
              maps: {
                ...counted.maps,
                clientLatencyBuckets: { [latencyBucket(event.clientLatencyMs)]: 1 },
              },
            },
      );
    },
  };
}

/** The turn log that also counts each event on the day's rollup, finishing both before it returns. */
export function withTurnMetrics(log: TurnLog, metrics: MetricsRecorder): TurnLog {
  return {
    decided: async (turn) => {
      await log.decided(turn);
      await metrics.turnDecided(turn);
    },
    resolved: async (event) => {
      await log.resolved(event);
      await metrics.turnResolved(event);
    },
  };
}

/** The rollup DAO named by METRIC_ROLLUPS_TABLE, or null where counters are not kept. */
export function createMetricRollupDaoFor(
  env: Readonly<Record<string, string | undefined>>,
): MetricRollupDao | null {
  const table = env["METRIC_ROLLUPS_TABLE"];
  return table === undefined || table === "" ? null : createDynamoMetricRollupDao(table);
}

/** The day's counters over the table named by METRIC_ROLLUPS_TABLE, or undefined where none is kept. */
export function createDeployedMetricsRecorder(
  logger: Logger,
  env: Readonly<Record<string, string | undefined>> = process.env,
): MetricsRecorder | undefined {
  const rollups = createMetricRollupDaoFor(env);
  return rollups === null ? undefined : createMetricsRecorder(rollups, logger);
}

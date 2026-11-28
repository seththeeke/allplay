import { createDynamoMetricRollupDao } from "../../dao/metricRollup/dynamoMetricRollupDao";
import type { MetricRollupDao } from "../../dao/metricRollup/metricRollupDao";
import { createDynamoPlayerDao } from "../../dao/player/dynamoPlayerDao";
import type { PlayerDao } from "../../dao/player/playerDao";
import {
  LATENCY_HISTOGRAMS,
  type MetricRollup,
  type RollupTotals,
} from "../../models/metricRollup";
import { percentile } from "./percentiles";

const DAY_MS = 24 * 60 * 60 * 1000;

/** p50 and p95 of every histogram of a day (productionalization.md section 7); null where it has none. */
export function latencyPercentiles(
  day: MetricRollup | null,
): Pick<RollupTotals, `${(typeof LATENCY_HISTOGRAMS)[number]}P${"50" | "95"}Ms`> {
  return Object.fromEntries(
    LATENCY_HISTOGRAMS.flatMap((name) => {
      const buckets = day?.[`${name}Buckets`];
      return [
        [`${name}P50Ms`, buckets === undefined ? null : percentile(buckets, 0.5)],
        [`${name}P95Ms`, buckets === undefined ? null : percentile(buckets, 0.95)],
      ];
    }),
  );
}

export interface RollupJob {
  /** Rolls up the UTC day before `now`; returns the day and what it wrote. */
  run(): Promise<{ period: string; totals: RollupTotals }>;
}

/**
 * The daily rollup (data-model.md section 11, writer 2): one scan of the
 * players for the day's totals, then latency percentiles from the day's
 * histograms. Merged and deleted players are not counted as players.
 */
export function createRollupJob(deps: {
  players: Pick<PlayerDao, "listForRollup">;
  rollups: MetricRollupDao;
  now?: () => Date;
}): RollupJob {
  const now = deps.now ?? (() => new Date());
  return {
    run: async () => {
      const at = now();
      const dayEnd = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
      const period = new Date(dayEnd.getTime() - DAY_MS).toISOString().slice(0, 10);
      const activeSince = new Date(dayEnd.getTime() - 30 * DAY_MS).toISOString();
      const players = await deps.players.listForRollup();
      const active = players.filter((player) => player.status === "ACTIVE");
      const day = await deps.rollups.get(period);
      const totals: RollupTotals = {
        totalPlayers: active.length,
        totalAccounts: active.filter((player) => player.kind === "ACCOUNT").length,
        totalGuests: active.filter((player) => player.kind === "GUEST").length,
        activePlayers30d: active.filter((player) => player.lastActiveAt >= activeSince).length,
        newPlayers: players.filter((player) => player.createdAt.startsWith(period)).length,
        ...latencyPercentiles(day),
      };
      await deps.rollups.setTotals(period, totals, at.toISOString());
      return { period, totals };
    },
  };
}

/** The rollup over the tables named by PLAYERS_TABLE and METRIC_ROLLUPS_TABLE. */
export function createDeployedRollupJob(
  env: Readonly<Record<string, string | undefined>> = process.env,
): RollupJob {
  return createRollupJob({
    players: createDynamoPlayerDao(env["PLAYERS_TABLE"] ?? ""),
    rollups: createDynamoMetricRollupDao(env["METRIC_ROLLUPS_TABLE"] ?? ""),
  });
}

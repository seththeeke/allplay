import { latencyPercentiles } from "../metrics/rollupJob";
import { createDynamoMetricRollupDao } from "../../dao/metricRollup/dynamoMetricRollupDao";
import type { MetricRollupDao } from "../../dao/metricRollup/metricRollupDao";
import { createLogsInsightsTurnLogReader } from "../../dao/turnLog/logsInsightsTurnLogReader";
import type { TurnLogReader } from "../../dao/turnLog/turnLogReader";
import type {
  AdminDecision,
  AdminDecisionsResponse,
  DayMetrics,
  MetricsResponse,
} from "../../models/api";
import type { MetricRollup } from "../../models/metricRollup";
import { invalidRequest } from "../gameSession/errors";

/** The longest metrics range one request reads. */
const MAX_DAYS = 92;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface MetricsAdminService {
  /** `GET /v1/admin/metrics?from=&to=` over the daily rollups (data-model.md section 11). */
  metrics(from: string, to: string): Promise<MetricsResponse>;
  /** `GET /v1/admin/decisions?day=&class=`: a day's turns from the turn log, newest first. */
  failures(day: string, failureClass?: string): Promise<AdminDecisionsResponse>;
}

function dayMetrics(item: MetricRollup): DayMetrics {
  return {
    period: item.period,
    totalPlayers: item.totalPlayers ?? 0,
    totalAccounts: item.totalAccounts ?? 0,
    totalGuests: item.totalGuests ?? 0,
    activePlayers30d: item.activePlayers30d ?? 0,
    newPlayers: item.newPlayers ?? 0,
    gamesStarted: item.gamesStarted,
    gamesWon: item.gamesWon,
    gamesAbandoned: item.gamesAbandoned,
    decisions: item.decisions,
    hardFailures: item.hardFailures,
    softFailures: item.softFailures,
    llmCalls: item.llmCalls,
    llmInputTokens: item.llmInputTokens,
    llmOutputTokens: item.llmOutputTokens,
    /* The rollup writes percentiles for finished days; today's come from its histograms so far. */
    ...Object.fromEntries(
      Object.entries(latencyPercentiles(item)).map(([field, computed]) => [
        field,
        (item as Record<string, unknown>)[field] ?? computed,
      ]),
    ),
  } as DayMetrics;
}

/** Logs Insights writes `2026-11-22 23:10:50.944`; the local reader already writes ISO 8601. */
export function isoOf(timestamp: string): string {
  return timestamp.includes("T") ? timestamp : `${timestamp.replace(" ", "T")}Z`;
}

const CLASSES = new Set(["HARD", "SOFT", "NONE", "PENDING"]);

export function createMetricsAdminService(deps: {
  rollups: Pick<MetricRollupDao, "range">;
  turns: TurnLogReader;
}): MetricsAdminService {
  return {
    metrics: async (from, to) => {
      if (!DAY.test(from) || !DAY.test(to) || from > to)
        throw invalidRequest("Send from and to as yyyy-mm-dd, from first.");
      if ((Date.parse(to) - Date.parse(from)) / 86_400_000 >= MAX_DAYS)
        throw invalidRequest(`Ask for at most ${String(MAX_DAYS)} days.`);
      return { days: (await deps.rollups.range(from, to)).map(dayMetrics) };
    },
    failures: async (day, failureClass) => {
      if (!DAY.test(day)) throw invalidRequest("Send day as yyyy-mm-dd.");
      if (failureClass !== undefined && !CLASSES.has(failureClass))
        throw invalidRequest("class is HARD, SOFT, NONE or PENDING.");
      /* A turn is its decided event, settled by its last resolution when there is one. */
      const turns = new Map<string, AdminDecision>();
      for (const event of await deps.turns.day(day)) {
        const known = turns.get(event.decisionId);
        if (event.event === "TURN_DECIDED") {
          turns.set(event.decisionId, {
            decisionId: event.decisionId,
            createdAt: isoOf(event.timestamp),
            gameId: event.gameId ?? null,
            transcript: event.transcript ?? "",
            outcome: event.outcome,
            failureClass: (event.failureClass ?? "PENDING") as AdminDecision["failureClass"],
            clientLatencyMs: null,
          });
        } else if (known !== undefined) {
          known.outcome = event.outcome;
          known.failureClass = (event.failureClass ?? "NONE") as AdminDecision["failureClass"];
          known.clientLatencyMs = event.clientLatencyMs ?? known.clientLatencyMs;
        }
      }
      const decisions = [...turns.values()]
        .filter((turn) => failureClass === undefined || turn.failureClass === failureClass)
        .reverse();
      return { decisions };
    },
  };
}

/** The admin metrics over METRIC_ROLLUPS_TABLE and the DecisionApi log group named by TURN_LOG_GROUP. */
export function createDeployedMetricsAdminService(
  env: Readonly<Record<string, string | undefined>> = process.env,
): MetricsAdminService {
  return createMetricsAdminService({
    rollups: createDynamoMetricRollupDao(env["METRIC_ROLLUPS_TABLE"] ?? ""),
    turns: createLogsInsightsTurnLogReader(env["TURN_LOG_GROUP"] ?? ""),
  });
}

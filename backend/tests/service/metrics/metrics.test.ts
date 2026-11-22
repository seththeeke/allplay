import { describe, expect, it, vi } from "vitest";
import { createInMemoryMetricRollupDao } from "../../../src/dao/metricRollup/inMemoryMetricRollupDao";
import { createInMemoryPlayerDao } from "../../../src/dao/player/inMemoryPlayerDao";
import { createLogger } from "../../../src/logger";
import { emptyDay } from "../../../src/models/metricRollup";
import type { Decision } from "../../../src/models/decision";
import { createLoggerTurnLog } from "../../../src/service/decision/turnLog";
import {
  createMetricRollupDaoFor,
  createMetricsRecorder,
  withTurnMetrics,
} from "../../../src/service/metrics/metricsRecorder";
import { percentile } from "../../../src/service/metrics/percentiles";
import { createDeployedRollupJob, createRollupJob } from "../../../src/service/metrics/rollupJob";
import { guest, account } from "../../dao/player/playerDaoContract";

const NOW = new Date("2026-11-22T10:00:00.000Z");
const turn = (extra: Partial<Decision> = {}): Decision => ({
  decisionId: "d1",
  playerId: "GUEST#g",
  transcriptSource: "TYPED",
  transcript: "deal",
  alternatives: [],
  uiContext: { screen: "GAME", pendingDecisionId: null },
  classification: {
    category: "GAME",
    response: null,
    modelId: "m",
    latencyMs: 1,
    inputTokens: 100,
    outputTokens: 5,
  },
  selection: { selectedIds: [], modelId: "m", latencyMs: 1, inputTokens: 200, outputTokens: 10 },
  outcome: "PROPOSED",
  serverLatencyMs: 900,
  createdAt: NOW.toISOString(),
  ...extra,
});

describe("latency percentiles", () => {
  it("interpolates within the bucket, reads overflow as its lower bound, and is null when empty", () => {
    const buckets = emptyDay("2026-11-22", NOW.toISOString()).clientLatencyBuckets;
    expect(percentile(buckets, 0.5)).toBeNull();
    expect(percentile({ ...buckets, le1000: 2, le2000: 2 }, 0.5)).toBe(1000);
    expect(percentile({ ...buckets, le1000: 2, le2000: 2 }, 0.75)).toBe(1750);
    expect(percentile({ ...buckets, le250: 4 }, 0.5)).toBe(125);
    expect(percentile({ ...buckets, overflow: 1 }, 0.95)).toBe(5000);
  });
});

describe("metrics recorder", () => {
  it("counts games, turns, outcomes, failures, tokens and latency on today's rollup", async () => {
    const dao = createInMemoryMetricRollupDao();
    const recorder = createMetricsRecorder(dao, createLogger({ write: vi.fn() }), () => NOW);
    await recorder.gameStarted("spider-solitaire");
    await recorder.gameEnded("spider-solitaire", "WON");
    await recorder.gameEnded("spider-solitaire", "ABANDONED");
    const log = withTurnMetrics(createLoggerTurnLog(createLogger({ write: vi.fn() })), recorder);
    await log.decided(turn());
    await log.decided(
      turn({ outcome: "UNRECOGNIZED", failureClass: "HARD", selection: undefined }),
    );
    await log.resolved({
      decisionId: "d1",
      playerId: "GUEST#g",
      resolution: "CHOSE_OPTION",
      outcome: "CHOSE_OPTION",
      failureClass: "SOFT",
      clientLatencyMs: 1600,
    });
    await log.resolved({
      decisionId: "d2",
      playerId: "GUEST#g",
      resolution: "SUPERSEDED",
      outcome: "EXPIRED",
      failureClass: "NONE",
    });
    expect(await dao.get("2026-11-22")).toMatchObject({
      gamesStarted: { "spider-solitaire": 1 },
      gamesWon: { "spider-solitaire": 1 },
      gamesAbandoned: { "spider-solitaire": 1 },
      decisions: 2,
      llmCalls: 3,
      llmInputTokens: 400,
      llmOutputTokens: 20,
      hardFailures: 1,
      softFailures: 1,
      decisionOutcomes: { UNRECOGNIZED: 1, CHOSE_OPTION: 1, EXPIRED: 1 },
      serverLatencyBuckets: { le1000: 2 },
      clientLatencyBuckets: { le2000: 1 },
    });
  });

  it("logs a failed counter write instead of failing the request", async () => {
    const write = vi.fn();
    const broken = {
      ...createInMemoryMetricRollupDao(),
      add: () => Promise.reject(new Error("down")),
    };
    await createMetricsRecorder(broken, createLogger({ write })).gameStarted("chess");
    expect(JSON.stringify(write.mock.calls)).toContain("Metric counters not written");
    expect(createMetricRollupDaoFor({})).toBeNull();
    expect(createMetricRollupDaoFor({ METRIC_ROLLUPS_TABLE: "" })).toBeNull();
    expect(createMetricRollupDaoFor({ METRIC_ROLLUPS_TABLE: "t" })).not.toBeNull();
  });
});

describe("daily rollup job", () => {
  it("rolls up yesterday's players and latency percentiles", async () => {
    const players = createInMemoryPlayerDao();
    await players.create({
      ...guest("GUEST#new", "2026-11-21T08:00:00.000Z"),
      lastActiveAt: "2026-11-21T08:00:00.000Z",
    });
    await players.create({
      ...guest("GUEST#old", "2026-09-01T08:00:00.000Z"),
      lastActiveAt: "2026-09-01T08:00:00.000Z",
    });
    await players.create(account("ACCT#a", "a@example.com", "2026-11-01T08:00:00.000Z"));
    await players.create({
      ...account("ACCT#gone", "b@example.com", "2026-10-01T08:00:00.000Z"),
      status: "DELETED",
    });
    const rollups = createInMemoryMetricRollupDao();
    await rollups.add(
      "2026-11-21",
      { maps: { clientLatencyBuckets: { le1000: 2, le2000: 2 } } },
      NOW.toISOString(),
    );
    const job = createRollupJob({
      players,
      rollups,
      now: () => new Date("2026-11-22T00:15:00.000Z"),
    });
    const { period, totals } = await job.run();
    expect(period).toBe("2026-11-21");
    expect(totals).toMatchObject({
      totalPlayers: 3,
      totalAccounts: 1,
      totalGuests: 2,
      newPlayers: 1,
      clientLatencyP50Ms: 1000,
      serverLatencyP50Ms: null,
    });
    expect(totals.activePlayers30d).toBe(2);
    expect(await rollups.get("2026-11-21")).toMatchObject({ totalPlayers: 3 });
    const quiet = createRollupJob({ players, rollups: createInMemoryMetricRollupDao() });
    expect((await quiet.run()).totals.clientLatencyP95Ms).toBeNull();
    expect(typeof createDeployedRollupJob({}).run).toBe("function");
  });

  it("builds the scheduled handler", async () => {
    const { handler } = await import("../../../src/controller/scheduled/metricsRollup");
    expect(typeof handler).toBe("function");
  });
});

describe("game counters", () => {
  it("counts a start and an abandon through the session service", async () => {
    const { createInMemoryGameTables } =
      await import("../../../src/dao/gameSession/inMemoryGameSessionDao");
    const { createBundledRulesRepository } = await import("../../../src/game-catalog");
    const { createGameSessionService, createDeployedGameSessionService } =
      await import("../../../src/service/gameSession/gameSessionService");
    const { createDeployedDecisionService } =
      await import("../../../src/service/decision/deployedDecider");
    const repository = createBundledRulesRepository();
    const rollups = createInMemoryMetricRollupDao();
    const sessions = createGameSessionService({
      ...createInMemoryGameTables(),
      metrics: createMetricsRecorder(rollups, createLogger({ write: vi.fn() }), () => NOW),
      games: (gameId, version) => repository.compiled(gameId, version),
    });
    const started = await sessions.start("GUEST#g", { gameId: "spider-solitaire" });
    await sessions.abandon("GUEST#g", started.session.sessionId, { expectedVersion: 0 });
    expect(await rollups.get("2026-11-22")).toMatchObject({
      gamesStarted: { "spider-solitaire": 1 },
      gamesAbandoned: { "spider-solitaire": 1 },
    });
    const env = { METRIC_ROLLUPS_TABLE: "AllPlay-MetricRollups-Test" };
    expect(typeof createDeployedGameSessionService(repository, env).start).toBe("function");
    expect(typeof createDeployedDecisionService(createLogger({ write: vi.fn() }), env).decide).toBe(
      "function",
    );
  });
});

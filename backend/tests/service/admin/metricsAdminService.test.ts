import { describe, expect, it } from "vitest";
import { createInMemoryMetricRollupDao } from "../../../src/dao/metricRollup/inMemoryMetricRollupDao";
import type { LoggedTurnEvent } from "../../../src/dao/turnLog/turnLogReader";
import {
  createDeployedMetricsAdminService,
  createMetricsAdminService,
  isoOf,
} from "../../../src/service/admin/metricsAdminService";

const decided = (decisionId: string, failureClass?: string): LoggedTurnEvent => ({
  event: "TURN_DECIDED",
  decisionId,
  timestamp: `2026-11-21 0${decisionId.slice(1)}:00:00.000`,
  transcript: `turn ${decisionId}`,
  outcome: failureClass === undefined ? "PROPOSED" : "UNRECOGNIZED",
  failureClass,
});

describe("metrics admin service", () => {
  it("settles each turn by its last resolution and filters by class, newest first", async () => {
    const service = createMetricsAdminService({
      rollups: createInMemoryMetricRollupDao(),
      turns: {
        day: () =>
          Promise.resolve([
            decided("d1"),
            decided("d2", "HARD"),
            decided("d3"),
            decided("d4"),
            {
              event: "TURN_RESOLVED",
              decisionId: "d1",
              timestamp: "2026-11-21 01:00:05.000",
              outcome: "CHOSE_OPTION",
              failureClass: "SOFT",
              clientLatencyMs: 1500,
            },
            {
              event: "TURN_RESOLVED",
              decisionId: "d4",
              timestamp: "2026-11-21 04:00:05.000",
              outcome: "ACKNOWLEDGED",
            },
            { event: "TURN_RESOLVED", decisionId: "gone", timestamp: "", outcome: "REJECTED" },
          ]),
      },
    });
    const all = (await service.failures("2026-11-21")).decisions;
    expect(all.map((turn) => [turn.decisionId, turn.failureClass])).toEqual([
      ["d4", "NONE"],
      ["d3", "PENDING"],
      ["d2", "HARD"],
      ["d1", "SOFT"],
    ]);
    expect(all.find((turn) => turn.decisionId === "d1")).toMatchObject({
      outcome: "CHOSE_OPTION",
      clientLatencyMs: 1500,
      createdAt: "2026-11-21T01:00:00.000Z",
      gameId: null,
    });
    expect((await service.failures("2026-11-21", "PENDING")).decisions).toHaveLength(1);
    await expect(service.failures("yesterday")).rejects.toThrow("yyyy-mm-dd");
    await expect(service.failures("2026-11-21", "BAD")).rejects.toThrow("class is");
  });

  it("checks the metrics range", async () => {
    const service = createMetricsAdminService({
      rollups: createInMemoryMetricRollupDao(),
      turns: { day: () => Promise.resolve([]) },
    });
    expect(await service.metrics("2026-11-01", "2026-11-30")).toEqual({ days: [] });
    await expect(service.metrics("2026-11-30", "2026-11-01")).rejects.toThrow("from first");
    await expect(service.metrics("2026-01-01", "2026-12-31")).rejects.toThrow("at most 92 days");
    expect(isoOf("2026-11-21T01:00:00.000Z")).toBe("2026-11-21T01:00:00.000Z");
    expect(typeof createDeployedMetricsAdminService({}).metrics).toBe("function");
  });
});

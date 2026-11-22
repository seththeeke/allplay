import { expect, it } from "vitest";
import type { MetricRollupDao } from "../../../src/dao/metricRollup/metricRollupDao";

/** The behavior every MetricRollupDao must have (data-model.md section 11). */
export function metricRollupDaoContract(create: () => MetricRollupDao, period: string): void {
  it("creates a day on its first add, then adds counters and map entries", async () => {
    const dao = create();
    expect(await dao.get(period)).toBeNull();
    await dao.add(
      period,
      {
        counters: { decisions: 1, llmCalls: 2 },
        maps: { gamesStarted: { "spider-solitaire": 1 }, serverLatencyBuckets: { le500: 1 } },
      },
      `${period}T10:00:00.000Z`,
    );
    await dao.add(
      period,
      { counters: { decisions: 1 }, maps: { gamesStarted: { "spider-solitaire": 1, chess: 1 } } },
      `${period}T11:00:00.000Z`,
    );
    await dao.add(period, {}, `${period}T11:30:00.000Z`);
    const day = await dao.get(period);
    expect(day).toMatchObject({
      rollupType: "DAY",
      period,
      decisions: 2,
      llmCalls: 2,
      hardFailures: 0,
      gamesStarted: { "spider-solitaire": 2, chess: 1 },
      serverLatencyBuckets: { le500: 1, le250: 0 },
      createdAt: `${period}T10:00:00.000Z`,
      updatedAt: `${period}T11:00:00.000Z`,
    });
  });

  it("writes the rollup's totals and reads a range of days", async () => {
    const dao = create();
    await dao.setTotals(
      period,
      { totalPlayers: 4, newPlayers: 1, clientLatencyP50Ms: null },
      `${period}T23:59:00.000Z`,
    );
    expect(await dao.get(period)).toMatchObject({ totalPlayers: 4, clientLatencyP50Ms: null });
    expect((await dao.range(period, period)).map((day) => day.period)).toEqual([period]);
    expect(await dao.range("1990-01-01", "1990-01-02")).toEqual([]);
  });
}

import { describe, expect, it } from "vitest";
import { createDynamoMetricRollupDao } from "../../../src/dao/metricRollup/dynamoMetricRollupDao";
import { createInMemoryMetricRollupDao } from "../../../src/dao/metricRollup/inMemoryMetricRollupDao";
import { emptyDay, latencyBucket } from "../../../src/models/metricRollup";
import { conditionalCheckFailed, stubDynamo } from "../dynamoStub";
import { metricRollupDaoContract } from "./metricRollupDaoContract";

describe("in-memory metric rollups", () => {
  const shared = createInMemoryMetricRollupDao();
  metricRollupDaoContract(() => shared, "2026-11-20");
  it("orders a range oldest first", async () => {
    const dao = createInMemoryMetricRollupDao();
    await dao.add("2026-11-21", { counters: { decisions: 1 } }, "2026-11-21T00:00:00.000Z");
    await dao.add("2026-11-20", { counters: { decisions: 1 } }, "2026-11-20T00:00:00.000Z");
    expect((await dao.range("2026-11-01", "2026-11-30")).map((day) => day.period)).toEqual([
      "2026-11-20",
      "2026-11-21",
    ]);
  });
});

describe("DynamoMetricRollupDao", () => {
  it("creates the day once, then adds inside its maps", async () => {
    const stub = stubDynamo(conditionalCheckFailed(), {}, {}, {});
    const dao = createDynamoMetricRollupDao("AllPlay-MetricRollups-Test", stub);
    const at = "2026-11-22T10:00:00.000Z";
    await dao.add(
      "2026-11-22",
      { counters: { decisions: 1 }, maps: { gamesWon: { chess: 1 } } },
      at,
    );
    await dao.add("2026-11-22", { counters: { llmCalls: 2 } }, at);
    expect(stub.sent.map((sent) => sent.command)).toEqual([
      "PutCommand",
      "UpdateCommand",
      "UpdateCommand",
    ]);
    expect(stub.sent[0]?.input).toMatchObject({
      Item: emptyDay("2026-11-22", at),
      ConditionExpression: "attribute_not_exists(#p)",
    });
    expect(stub.sent[1]?.input).toEqual({
      TableName: "AllPlay-MetricRollups-Test",
      Key: { rollupType: "DAY", period: "2026-11-22" },
      UpdateExpression: "ADD #decisions :v1, #gamesWon.#k2 :v3 SET #updated = :at",
      ExpressionAttributeNames: {
        "#updated": "updatedAt",
        "#decisions": "decisions",
        "#gamesWon": "gamesWon",
        "#k2": "chess",
      },
      ExpressionAttributeValues: { ":at": at, ":v1": 1, ":v3": 1 },
    });
  });

  it("passes other write failures through, sets totals, and reads days", async () => {
    const failing = createDynamoMetricRollupDao("t", stubDynamo(new Error("down")));
    await expect(failing.add("2026-11-22", {}, "2026-11-22T00:00:00.000Z")).rejects.toThrow("down");
    const day = emptyDay("2026-11-22", "2026-11-22T00:00:00.000Z");
    const stub = stubDynamo({}, {}, { Item: day }, {}, { Items: [day] });
    const dao = createDynamoMetricRollupDao("t", stub);
    await dao.setTotals("2026-11-22", { totalPlayers: 3 }, "2026-11-23T00:15:00.000Z");
    expect(stub.sent[1]?.command).toBe("UpdateCommand");
    expect(await dao.get("2026-11-22")).toEqual(day);
    expect(await dao.get("2026-11-23")).toBeNull();
    expect(await dao.range("2026-11-22", "2026-11-22")).toEqual([day]);
    expect(stub.sent[4]?.input).toMatchObject({
      KeyConditionExpression: "rollupType = :t AND #p BETWEEN :from AND :to",
    });
  });

  it("puts each latency in its bucket", () => {
    expect(latencyBucket(0)).toBe("le250");
    expect(latencyBucket(250)).toBe("le250");
    expect(latencyBucket(1600)).toBe("le2000");
    expect(latencyBucket(5001)).toBe("overflow");
  });
});

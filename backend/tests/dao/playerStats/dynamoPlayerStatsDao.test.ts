import { describe, expect, it } from "vitest";
import { createDynamoPlayerStatsDao } from "../../../src/dao/playerStats/dynamoPlayerStatsDao";
import { StatsVersionConflictError } from "../../../src/dao/playerStats/playerStatsDao";
import { sampleStats } from "../gameSession/gameSessionDaoContract";
import { cancelled, stubDynamo } from "../dynamoStub";

const TABLE = "AllPlay-PlayerStats-Test";
const item = sampleStats("ACCT#a");

describe("DynamoPlayerStatsDao", () => {
  it("gets, lists and deletes", async () => {
    const stub = stubDynamo({ Item: item }, {}, { Items: [item] }, {});
    const dao = createDynamoPlayerStatsDao(TABLE, stub);
    expect(await dao.get("ACCT#a", item.statsKey)).toEqual(item);
    expect(await dao.get("ACCT#a", "x")).toBeNull();
    expect(await dao.list("ACCT#a")).toEqual([item]);
    await dao.delete("ACCT#a", item.statsKey);
    expect(stub.sent[3]).toMatchObject({
      command: "DeleteCommand",
      input: { Key: { playerId: "ACCT#a", statsKey: item.statsKey } },
    });
  });

  it("moves an item in one transaction conditioned on the target's version", async () => {
    const stub = stubDynamo({}, cancelled(["ConditionalCheckFailed", "None"]), new Error("down"));
    const dao = createDynamoPlayerStatsDao(TABLE, stub);
    const from = { playerId: "GUEST#g", statsKey: item.statsKey };
    await dao.moveInto({ item, expectedVersion: null }, from);
    expect(stub.sent[0]?.input).toEqual({
      TransactItems: [
        {
          Put: {
            TableName: TABLE,
            Item: item,
            ConditionExpression: "attribute_not_exists(playerId)",
          },
        },
        { Delete: { TableName: TABLE, Key: from } },
      ],
    });
    await expect(dao.moveInto({ item, expectedVersion: 3 }, from)).rejects.toBeInstanceOf(
      StatsVersionConflictError,
    );
    expect(stub.sent[1]?.input).toMatchObject({
      TransactItems: [
        {
          Put: {
            ConditionExpression: "#version = :expected",
            ExpressionAttributeValues: { ":expected": 3 },
          },
        },
        {},
      ],
    });
    await expect(dao.moveInto({ item, expectedVersion: 3 }, from)).rejects.toThrow("down");
  });
});

import { describe, expect, it } from "vitest";
import { createDynamoRateLimitCounterDao } from "../../../src/dao/rateLimitCounter/dynamoRateLimitCounterDao";
import { createInMemoryRateLimitCounterDao } from "../../../src/dao/rateLimitCounter/inMemoryRateLimitCounterDao";
import { conditionalCheckFailed, stubDynamo } from "../dynamoStub";
import { rateLimitCounterDaoContract } from "./rateLimitCounterDaoContract";

describe("in-memory rate limit counters", () => {
  rateLimitCounterDaoContract(() => createInMemoryRateLimitCounterDao());
});

describe("DynamoRateLimitCounterDao", () => {
  it("adds one under the limit, keeping the first ttl, and reads a failed condition as full", async () => {
    const stub = stubDynamo({}, conditionalCheckFailed(), new Error("down"));
    const dao = createDynamoRateLimitCounterDao("AllPlay-RateLimits-Test", stub);
    expect(await dao.increment("k", 20, 99)).toBe(true);
    expect(stub.sent[0]).toEqual({
      command: "UpdateCommand",
      input: {
        TableName: "AllPlay-RateLimits-Test",
        Key: { counterKey: "k" },
        UpdateExpression: "ADD #count :one SET #ttl = if_not_exists(#ttl, :ttl)",
        ConditionExpression: "attribute_not_exists(counterKey) OR #count < :limit",
        ExpressionAttributeNames: { "#count": "count", "#ttl": "ttl" },
        ExpressionAttributeValues: { ":one": 1, ":ttl": 99, ":limit": 20 },
      },
    });
    expect(await dao.increment("k", 20, 99)).toBe(false);
    await expect(dao.increment("k", 20, 99)).rejects.toThrow("down");
  });
});

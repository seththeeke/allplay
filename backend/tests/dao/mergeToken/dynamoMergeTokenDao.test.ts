import { describe, expect, it } from "vitest";
import { createDynamoMergeTokenDao } from "../../../src/dao/mergeToken/dynamoMergeTokenDao";
import { conditionalCheckFailed, stubDynamo } from "../dynamoStub";
import { issued } from "./mergeTokenDaoContract";

const TABLE = "AllPlay-MergeTokens-Test";
const HASH = "a".repeat(64);

describe("DynamoMergeTokenDao", () => {
  it("creates a token only when the hash is new", async () => {
    const stub = stubDynamo({});
    await createDynamoMergeTokenDao(TABLE, stub).create(issued(HASH, "GUEST#g-1"));
    expect(stub.sent[0]).toMatchObject({
      command: "PutCommand",
      input: { TableName: TABLE, ConditionExpression: "attribute_not_exists(tokenHash)" },
    });
  });

  it("redeems with the issued-or-mine and unexpired condition", async () => {
    const token = { ...issued(HASH, "GUEST#g-1"), status: "REDEEMED", redeemedBy: "ACCT#a" };
    const stub = stubDynamo(
      { Attributes: token },
      conditionalCheckFailed(),
      new Error("throttled"),
    );
    const dao = createDynamoMergeTokenDao(TABLE, stub);
    expect(await dao.redeem(HASH, "ACCT#a", "2026-11-21T12:01:00.000Z", 100)).toEqual(token);
    expect(stub.sent[0]?.input).toMatchObject({
      Key: { tokenHash: HASH },
      ConditionExpression:
        "attribute_exists(tokenHash) AND #ttl > :now AND (#status = :issued OR redeemedBy = :me)",
      ExpressionAttributeValues: { ":me": "ACCT#a", ":now": 100 },
    });
    expect(await dao.redeem(HASH, "ACCT#a", "x", 100)).toBeNull();
    await expect(dao.redeem(HASH, "ACCT#a", "x", 100)).rejects.toThrow("throttled");
  });
});

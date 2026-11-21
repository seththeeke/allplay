import { describe, expect, it } from "vitest";
import { documentClient, updateExpression } from "../../../src/dao/dynamo";
import { createDynamoPreferenceDao } from "../../../src/dao/preference/dynamoPreferenceDao";
import { stubDynamo } from "../dynamoStub";

const TABLE = "AllPlay-Preferences-Test";
const ITEM = {
  playerId: "GUEST#g",
  scope: "APP",
  zoomLevel: 2,
  entityVersion: 1,
  createdAt: "2026-11-21T12:00:00.000Z",
  updatedAt: "2026-11-21T12:00:00.000Z",
};

describe("DynamoPreferenceDao", () => {
  it("pages through a player's scopes", async () => {
    const stub = stubDynamo(
      { Items: [ITEM], LastEvaluatedKey: { playerId: "GUEST#g", scope: "APP" } },
      { Items: [{ ...ITEM, scope: "GAME#spider-solitaire" }] },
      {},
    );
    const dao = createDynamoPreferenceDao(TABLE, stub);
    expect((await dao.list("GUEST#g")).map((item) => item.scope)).toEqual([
      "APP",
      "GAME#spider-solitaire",
    ]);
    expect(stub.sent[1]?.input).toMatchObject({ ExclusiveStartKey: { scope: "APP" } });
    expect(await dao.list("GUEST#none")).toEqual([]);
  });

  it("patches only the given fields, creating the item fields once", async () => {
    const stub = stubDynamo({ Attributes: { ...ITEM, theme: "DARK", ttl: 5 } });
    const dao = createDynamoPreferenceDao(TABLE, stub);
    const patched = await dao.patch(
      "GUEST#g",
      "APP",
      { theme: "DARK" },
      "2026-11-21T12:05:00.000Z",
      5,
    );
    expect(patched).toMatchObject({ theme: "DARK", ttl: 5 });
    expect(stub.sent[0]?.input).toMatchObject({
      Key: { playerId: "GUEST#g", scope: "APP" },
      UpdateExpression:
        "SET #f1 = :v1, #f2 = :v2, #f3 = :v3, #f4 = if_not_exists(#f4, :v4), #f5 = if_not_exists(#f5, :v5)",
      ExpressionAttributeNames: {
        "#f1": "theme",
        "#f2": "updatedAt",
        "#f3": "ttl",
        "#f4": "createdAt",
        "#f5": "entityVersion",
      },
      ReturnValues: "ALL_NEW",
    });
    await expect(
      dao.patch("GUEST#g", "APP", { zoomLevel: 9 }, "2026-11-21T12:05:00.000Z"),
    ).rejects.toThrow();
  });
});

describe("DynamoDB helpers", () => {
  it("builds remove-only and empty expressions, and a real document client", () => {
    expect(updateExpression({}, ["ttl"]).UpdateExpression).toBe("REMOVE #f1");
    expect(updateExpression({ a: undefined }).UpdateExpression).toBe("");
    expect(typeof documentClient().send).toBe("function");
  });
});

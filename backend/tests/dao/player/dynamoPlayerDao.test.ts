import { describe, expect, it } from "vitest";
import { createDynamoPlayerDao } from "../../../src/dao/player/dynamoPlayerDao";
import { PlayerExistsError, PlayerMissingError } from "../../../src/dao/player/playerDao";
import { conditionalCheckFailed, stubDynamo } from "../dynamoStub";
import { account, guest } from "./playerDaoContract";

const TABLE = "AllPlay-Players-Test";
const AT = "2026-11-21T12:00:00.000Z";

describe("DynamoPlayerDao", () => {
  it("gets a player, turning string sets into sorted arrays", async () => {
    const stored = account("ACCT#sub-1", "pat@example.com");
    const stub = stubDynamo(
      {},
      {
        Item: {
          ...stored,
          identityIds: new Set(["b", "a"]),
          signInProviders: new Set(["GOOGLE", "APPLE"]),
        },
      },
      { Item: { ...guest("GUEST#g-1"), identityIds: undefined } },
    );
    const dao = createDynamoPlayerDao(TABLE, stub);
    expect(await dao.get("ACCT#none")).toBeNull();
    const player = await dao.get("ACCT#sub-1");
    expect(player?.identityIds).toEqual(["a", "b"]);
    expect(player?.signInProviders).toEqual(["APPLE", "GOOGLE"]);
    expect((await dao.get("GUEST#g-1"))?.identityIds).toEqual([]);
    expect(stub.sent[0]).toEqual({
      command: "GetCommand",
      input: { TableName: TABLE, Key: { playerId: "ACCT#none" }, ConsistentRead: true },
    });
  });

  it("creates with string sets and a not-exists condition, and maps a taken id", async () => {
    const stub = stubDynamo({}, conditionalCheckFailed(), new Error("throttled"));
    const dao = createDynamoPlayerDao(TABLE, stub);
    const player = { ...account("ACCT#sub-1", "pat@example.com"), mergedGuestIds: [] };
    await dao.create(player);
    const input = stub.sent[0]?.input as {
      Item: Record<string, unknown>;
      ConditionExpression: string;
    };
    expect(input.ConditionExpression).toBe("attribute_not_exists(playerId)");
    expect(input.Item["identityIds"]).toEqual(new Set(["us-east-1:identity"]));
    expect(input.Item).not.toHaveProperty("mergedGuestIds");
    await expect(dao.create(player)).rejects.toBeInstanceOf(PlayerExistsError);
    await expect(dao.create(player)).rejects.toThrow("throttled");
  });

  it("updates with placeholders, returns the new item, and maps a missing player", async () => {
    const stored = account("ACCT#sub-1", "pat@example.com");
    const stub = stubDynamo(
      { Attributes: { ...stored, displayName: "Pat" } },
      conditionalCheckFailed(),
      new Error("boom"),
    );
    const dao = createDynamoPlayerDao(TABLE, stub);
    const updated = await dao.update(
      "ACCT#sub-1",
      { displayName: "Pat", ttl: undefined },
      "2026-11-21T13:00:00.000Z",
      ["ttl"],
    );
    expect(updated.displayName).toBe("Pat");
    const input = stub.sent[0]?.input as Record<string, unknown>;
    expect(input).toMatchObject({
      Key: { playerId: "ACCT#sub-1" },
      ConditionExpression: "attribute_exists(#pk)",
      ReturnValues: "ALL_NEW",
      UpdateExpression: "SET #f1 = :v1, #f2 = :v2 REMOVE #f3",
      ExpressionAttributeNames: {
        "#f1": "displayName",
        "#f2": "updatedAt",
        "#f3": "ttl",
        "#pk": "playerId",
      },
    });
    await expect(dao.update("ACCT#x", {}, "2026-11-21T13:00:00.000Z")).rejects.toBeInstanceOf(
      PlayerMissingError,
    );
    await expect(dao.update("ACCT#x", {}, "2026-11-21T13:00:00.000Z")).rejects.toThrow("boom");
  });

  it("touches only when an hour has passed, and reports a failed condition as no write", async () => {
    const stub = stubDynamo({}, conditionalCheckFailed(), new Error("down"));
    const dao = createDynamoPlayerDao(TABLE, stub);
    const at = new Date("2026-11-21T13:00:00.000Z");
    expect(await dao.touch("GUEST#g", at, 99)).toBe(true);
    const input = stub.sent[0]?.input as Record<string, Record<string, unknown> | string>;
    expect(input["ConditionExpression"]).toBe("attribute_exists(#pk) AND #last <= :cutoff");
    expect(input["ExpressionAttributeValues"]).toMatchObject({
      ":cutoff": "2026-11-21T12:00:00.000Z",
    });
    expect(Object.values(input["ExpressionAttributeNames"] as object)).toContain("ttl");
    expect(await dao.touch("GUEST#g", at)).toBe(false);
    await expect(dao.touch("GUEST#g", at)).rejects.toThrow("down");
  });

  it("pages through the ByEmail index", async () => {
    const stub = stubDynamo(
      {
        Items: [
          {
            playerId: "ACCT#a",
            status: "ACTIVE",
            signInProviders: new Set(["GOOGLE"]),
            createdAt: "1",
          },
        ],
        LastEvaluatedKey: { playerId: "ACCT#a" },
      },
      { Items: [{ playerId: "ACCT#b", status: "MERGED", createdAt: "2" }] },
      {},
    );
    const dao = createDynamoPlayerDao(TABLE, stub);
    expect(await dao.listByEmail("pat@example.com")).toEqual([
      { playerId: "ACCT#a", status: "ACTIVE", signInProviders: ["GOOGLE"], createdAt: "1" },
      { playerId: "ACCT#b", status: "MERGED", signInProviders: [], createdAt: "2" },
    ]);
    expect(stub.sent[0]?.input).toMatchObject({
      IndexName: "ByEmail",
      KeyConditionExpression: "emailKey = :e",
    });
    expect(stub.sent[1]?.input).toMatchObject({ ExclusiveStartKey: { playerId: "ACCT#a" } });
    expect(await dao.listByEmail("nobody@example.com")).toEqual([]);
  });

  it("scans the ByEmail index in pages for the duplicate list", async () => {
    const stub = stubDynamo(
      {
        Items: [
          { emailKey: "pat@example.com", playerId: "ACCT#a", status: "ACTIVE", createdAt: "1" },
        ],
        LastEvaluatedKey: { playerId: "ACCT#a" },
      },
      {},
    );
    const dao = createDynamoPlayerDao(TABLE, stub);
    expect(await dao.listAllEmails()).toEqual([
      {
        emailKey: "pat@example.com",
        playerId: "ACCT#a",
        status: "ACTIVE",
        signInProviders: [],
        createdAt: "1",
      },
    ]);
    expect(stub.sent.map((sent) => sent.command)).toEqual(["ScanCommand", "ScanCommand"]);
    expect(stub.sent[0]?.input).toMatchObject({ TableName: TABLE, IndexName: "ByEmail" });
    expect(stub.sent[1]?.input).toMatchObject({ ExclusiveStartKey: { playerId: "ACCT#a" } });
  });

  it("counts a game in its window, opens a new one, retries a racing start, and gives back", async () => {
    const day = { period: "DAY" as const, windowStart: "2026-11-21" };
    const seed = guest("GUEST#g-1");
    const stub = stubDynamo(
      { Attributes: { gamesPlayed: { ...day, count: 3 } } },
      conditionalCheckFailed(),
      {},
      conditionalCheckFailed(),
      conditionalCheckFailed(),
      { Attributes: { gamesPlayed: { ...day, count: 2 } } },
      conditionalCheckFailed(),
      conditionalCheckFailed(),
      conditionalCheckFailed(),
      conditionalCheckFailed(),
      new Error("throttled"),
      {},
      conditionalCheckFailed(),
      new Error("throttled"),
      conditionalCheckFailed(),
      new Error("throttled"),
    );
    const dao = createDynamoPlayerDao("AllPlay-Players-Test", stub);
    expect(await dao.countGame("GUEST#g-1", day, 5, AT, seed)).toEqual({ ...day, count: 3 });
    expect(stub.sent[0]?.input).toMatchObject({
      UpdateExpression: "SET #gp.#c = #gp.#c + :one, updatedAt = :at",
      ConditionExpression: "#gp.#p = :p AND #gp.#ws = :ws AND #gp.#c < :limit",
      ExpressionAttributeValues: expect.objectContaining({ ":limit": 5 }) as unknown,
    });
    /* A new window starts at 1, writing the seed's fields only where the item has none. */
    expect(await dao.countGame("GUEST#g-1", day, null, AT, seed)).toEqual({ ...day, count: 1 });
    expect(stub.sent[1]?.input["ConditionExpression"]).toBe("#gp.#p = :p AND #gp.#ws = :ws");
    expect(stub.sent[2]?.input["ConditionExpression"]).toBe(
      "attribute_not_exists(#gp) OR #gp.#p <> :p OR #gp.#ws <> :ws",
    );
    expect(String(stub.sent[2]?.input["UpdateExpression"])).toContain("if_not_exists");
    /* Both writes refused: another start opened the window, so the count is tried once more. */
    expect(await dao.countGame("GUEST#g-1", day, 5, AT, seed)).toEqual({ ...day, count: 2 });
    expect(await dao.countGame("GUEST#g-1", day, 5, AT, seed)).toBeNull();
    expect(await dao.countGame("GUEST#g-1", day, 0, AT, seed)).toBeNull();
    await expect(dao.countGame("GUEST#g-1", day, 5, AT, seed)).rejects.toThrow("throttled");
    await dao.giveBackGame("GUEST#g-1", day, AT);
    await dao.giveBackGame("GUEST#g-1", day, AT);
    await expect(dao.giveBackGame("GUEST#g-1", day, AT)).rejects.toThrow("throttled");
    await expect(dao.countGame("GUEST#g-1", day, 5, AT, seed)).rejects.toThrow("throttled");
  });
});

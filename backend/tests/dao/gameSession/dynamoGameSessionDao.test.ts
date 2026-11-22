import { describe, expect, it } from "vitest";
import { createDynamoGameSessionDao } from "../../../src/dao/gameSession/dynamoGameSessionDao";
import {
  SessionExistsError,
  SessionVersionConflictError,
} from "../../../src/dao/gameSession/gameSessionDao";
import { decodeGameState } from "../../../src/dao/gameSession/gameStateCodec";
import { StatsVersionConflictError } from "../../../src/dao/playerStats/playerStatsDao";
import { cancelled, conditionalCheckFailed, stubDynamo } from "../dynamoStub";
import { sampleSeat, sampleSession, sampleStats } from "./gameSessionDaoContract";

const TABLES = {
  sessions: "AllPlay-GameSessions-Test",
  seats: "AllPlay-SeatAssignments-Test",
  stats: "AllPlay-PlayerStats-Test",
};
const session = sampleSession("s1");
const seat = sampleSeat(session);

describe("DynamoGameSessionDao", () => {
  it("creates the session and its seats in one transaction, storing state gzip-compressed", async () => {
    const stub = stubDynamo(
      {},
      cancelled(["ConditionalCheckFailed", "None"]),
      cancelled(["None", "ConditionalCheckFailed"]),
    );
    const dao = createDynamoGameSessionDao(TABLES, stub);
    await dao.create(session, [seat]);
    const items = (stub.sent[0]?.input["TransactItems"] ?? []) as {
      Put: { TableName: string; Item: Record<string, unknown>; ConditionExpression?: string };
    }[];
    expect(items[0]?.Put).toMatchObject({
      TableName: TABLES.sessions,
      ConditionExpression: "attribute_not_exists(sessionId)",
    });
    expect(decodeGameState(items[0]?.Put.Item["state"] as Uint8Array)).toEqual(session.state);
    expect(items[1]?.Put).toEqual({ TableName: TABLES.seats, Item: seat });
    await expect(dao.create(session, [seat])).rejects.toBeInstanceOf(SessionExistsError);
    await expect(dao.create(session, [seat])).rejects.toThrow("Transaction cancelled");
  });

  it("reads consistently and decodes the state", async () => {
    const stub = stubDynamo({ Item: { ...session, state: new Uint8Array(0) } }, {});
    const dao = createDynamoGameSessionDao(TABLES, stub);
    await expect(dao.get("s1")).rejects.toThrow();
    expect(await dao.get("s2")).toBeNull();
    expect(stub.sent[0]?.input).toMatchObject({ Key: { sessionId: "s1" }, ConsistentRead: true });
  });

  it("puts a move at the expected version", async () => {
    const stub = stubDynamo({}, conditionalCheckFailed(), new Error("down"));
    const dao = createDynamoGameSessionDao(TABLES, stub);
    await dao.update({ ...session, version: 1 }, 0);
    expect(stub.sent[0]).toMatchObject({
      command: "PutCommand",
      input: {
        ConditionExpression: "#version = :expected",
        ExpressionAttributeValues: { ":expected": 0 },
      },
    });
    await expect(dao.update(session, 0)).rejects.toBeInstanceOf(SessionVersionConflictError);
    await expect(dao.update(session, 0)).rejects.toThrow("down");
  });

  it("ends a session with seats and stats, telling the failed condition apart", async () => {
    const stub = stubDynamo(
      {},
      cancelled(["ConditionalCheckFailed", "None", "None"]),
      cancelled(["None", "None", "ConditionalCheckFailed"]),
      cancelled(["None", "TransactionConflict", "None"]),
      new Error("down"),
    );
    const dao = createDynamoGameSessionDao(TABLES, stub);
    const end = {
      session: { ...session, status: "WON" as const, version: 1 },
      expectedVersion: 0,
      seats: [seat],
      stats: [{ item: sampleStats("GUEST#p1", 2), expectedVersion: 1 }],
    };
    await dao.end(end);
    expect(stub.sent[0]?.input["TransactItems"]).toMatchObject([
      {
        Put: {
          TableName: TABLES.sessions,
          ConditionExpression: "#version = :expected AND #status = :inProgress",
          ExpressionAttributeValues: { ":expected": 0, ":inProgress": "IN_PROGRESS" },
        },
      },
      { Put: { TableName: TABLES.seats } },
      { Put: { TableName: TABLES.stats, ConditionExpression: "#version = :expected" } },
    ]);
    await expect(dao.end(end)).rejects.toBeInstanceOf(SessionVersionConflictError);
    await expect(dao.end(end)).rejects.toBeInstanceOf(StatsVersionConflictError);
    await expect(dao.end(end)).rejects.toThrow("Transaction cancelled");
    await expect(dao.end(end)).rejects.toThrow("down");
  });

  it("deletes a session", async () => {
    const stub = stubDynamo({});
    await createDynamoGameSessionDao(TABLES, stub).delete("s1");
    expect(stub.sent[0]).toMatchObject({
      command: "DeleteCommand",
      input: { TableName: TABLES.sessions, Key: { sessionId: "s1" } },
    });
  });
});

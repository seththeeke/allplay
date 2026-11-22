import { describe, expect, it } from "vitest";
import { createDynamoSeatAssignmentDao } from "../../../src/dao/seatAssignment/dynamoSeatAssignmentDao";
import { sampleSeat, sampleSession } from "../gameSession/gameSessionDaoContract";
import { stubDynamo } from "../dynamoStub";

const TABLE = "AllPlay-SeatAssignments-Test";
const seat = sampleSeat(sampleSession("s1"));

describe("DynamoSeatAssignmentDao", () => {
  it("reads one seat consistently, and null when absent", async () => {
    const stub = stubDynamo({ Item: seat }, {});
    const dao = createDynamoSeatAssignmentDao(TABLE, stub);
    expect(await dao.get("GUEST#p1", "s1")).toEqual(seat);
    expect(await dao.get("GUEST#p1", "s2")).toBeNull();
    expect(stub.sent[0]?.input).toMatchObject({
      Key: { playerId: "GUEST#p1", sessionId: "s1" },
      ConsistentRead: true,
    });
  });

  it("queries ByPlayerGame for the newest in-progress seat", async () => {
    const stub = stubDynamo({ Items: [seat] }, {});
    const dao = createDynamoSeatAssignmentDao(TABLE, stub);
    expect(await dao.currentFor("GUEST#p1", "spider-solitaire")).toEqual(seat);
    expect(await dao.currentFor("GUEST#p1", "spider-solitaire")).toBeNull();
    expect(stub.sent[0]?.input).toMatchObject({
      IndexName: "ByPlayerGame",
      KeyConditionExpression: "playerGameKey = :k AND begins_with(statusSortKey, :s)",
      ExpressionAttributeValues: { ":k": "GUEST#p1|spider-solitaire", ":s": "IN_PROGRESS#" },
      ScanIndexForward: false,
      Limit: 1,
    });
  });

  it("lists every page newest first, puts and deletes", async () => {
    const stub = stubDynamo(
      { Items: [seat], LastEvaluatedKey: { playerId: "GUEST#p1", sessionId: "s1" } },
      {},
      {},
      {},
    );
    const dao = createDynamoSeatAssignmentDao(TABLE, stub);
    expect(await dao.list("GUEST#p1")).toEqual([seat]);
    expect(stub.sent[0]?.input).toMatchObject({ ScanIndexForward: false, ConsistentRead: true });
    expect(stub.sent[1]?.input).toMatchObject({ ExclusiveStartKey: { sessionId: "s1" } });
    await dao.put(seat);
    await dao.delete("GUEST#p1", "s1");
    expect(stub.sent.map((sent) => sent.command)).toEqual([
      "QueryCommand",
      "QueryCommand",
      "PutCommand",
      "DeleteCommand",
    ]);
  });
});

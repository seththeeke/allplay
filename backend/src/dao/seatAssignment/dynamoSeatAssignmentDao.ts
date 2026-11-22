import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { SeatAssignmentSchema } from "../../models/seatAssignment";
import { documentClient, queryAll, type DocumentSender } from "../dynamo";
import type { SeatAssignmentDao } from "./seatAssignmentDao";

/** SeatAssignmentDao over `AllPlay-SeatAssignments-<Stage>` (data-model.md section 7). */
export function createDynamoSeatAssignmentDao(
  tableName: string,
  client: DocumentSender = documentClient(),
): SeatAssignmentDao {
  return {
    get: async (playerId, sessionId) => {
      const out = (await client.send(
        new GetCommand({
          TableName: tableName,
          Key: { playerId, sessionId },
          ConsistentRead: true,
        }),
      )) as { Item?: Record<string, unknown> };
      return out.Item === undefined ? null : SeatAssignmentSchema.parse(out.Item);
    },
    currentFor: async (playerId, gameId) => {
      /* The index is eventually consistent (data-model.md section 7). */
      const out = (await client.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: "ByPlayerGame",
          KeyConditionExpression: "playerGameKey = :k AND begins_with(statusSortKey, :s)",
          ExpressionAttributeValues: { ":k": `${playerId}|${gameId}`, ":s": "IN_PROGRESS#" },
          ScanIndexForward: false,
          Limit: 1,
        }),
      )) as { Items?: Record<string, unknown>[] };
      const [item] = out.Items ?? [];
      return item === undefined ? null : SeatAssignmentSchema.parse(item);
    },
    list: async (playerId) =>
      (
        await queryAll(
          client,
          (start) =>
            new QueryCommand({
              TableName: tableName,
              KeyConditionExpression: "playerId = :p",
              ExpressionAttributeValues: { ":p": playerId },
              ConsistentRead: true,
              ScanIndexForward: false,
              ExclusiveStartKey: start,
            }),
        )
      ).map((item) => SeatAssignmentSchema.parse(item)),
    put: async (seat) => {
      await client.send(
        new PutCommand({ TableName: tableName, Item: SeatAssignmentSchema.parse(seat) }),
      );
    },
    delete: async (playerId, sessionId) => {
      await client.send(new DeleteCommand({ TableName: tableName, Key: { playerId, sessionId } }));
    },
  };
}

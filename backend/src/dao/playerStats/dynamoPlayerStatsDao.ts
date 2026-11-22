import {
  DeleteCommand,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { PlayerStatsSchema } from "../../models/playerStats";
import { documentClient, failedConditions, queryAll, type DocumentSender } from "../dynamo";
import { StatsVersionConflictError, type PlayerStatsDao, type StatsWrite } from "./playerStatsDao";

/** A transaction item that writes a stats item at its expected version (data-model.md section 8). */
export function statsPut(tableName: string, write: StatsWrite): Record<string, unknown> {
  return {
    Put: {
      TableName: tableName,
      Item: PlayerStatsSchema.parse(write.item),
      ...(write.expectedVersion === null
        ? { ConditionExpression: "attribute_not_exists(playerId)" }
        : {
            ConditionExpression: "#version = :expected",
            ExpressionAttributeNames: { "#version": "version" },
            ExpressionAttributeValues: { ":expected": write.expectedVersion },
          }),
    },
  };
}

/** PlayerStatsDao over `AllPlay-PlayerStats-<Stage>` (data-model.md section 8). */
export function createDynamoPlayerStatsDao(
  tableName: string,
  client: DocumentSender = documentClient(),
): PlayerStatsDao {
  return {
    get: async (playerId, statsKey) => {
      const out = (await client.send(
        new GetCommand({ TableName: tableName, Key: { playerId, statsKey }, ConsistentRead: true }),
      )) as { Item?: Record<string, unknown> };
      return out.Item === undefined ? null : PlayerStatsSchema.parse(out.Item);
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
              ExclusiveStartKey: start,
            }),
        )
      ).map((item) => PlayerStatsSchema.parse(item)),
    moveInto: async (write, from) => {
      try {
        await client.send(
          new TransactWriteCommand({
            TransactItems: [
              statsPut(tableName, write),
              {
                Delete: {
                  TableName: tableName,
                  Key: { playerId: from.playerId, statsKey: from.statsKey },
                },
              },
            ],
          }),
        );
      } catch (error) {
        if ((failedConditions(error)?.length ?? 0) > 0)
          throw new StatsVersionConflictError(write.item.statsKey);
        throw error;
      }
    },
    delete: async (playerId, statsKey) => {
      await client.send(new DeleteCommand({ TableName: tableName, Key: { playerId, statsKey } }));
    },
  };
}

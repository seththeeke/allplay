import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { PlayerSchema, type Player } from "../../models/player";
import { conditionFailed, documentClient, updateExpression, type DocumentSender } from "../dynamo";
import {
  PlayerExistsError,
  PlayerMissingError,
  TOUCH_INTERVAL_MS,
  type EmailMatch,
  type PlayerDao,
} from "./playerDao";

/** Attributes stored as DynamoDB string sets (data-model.md section 4). */
const SET_FIELDS = [
  "identityIds",
  "signInProviders",
  "mergedGuestIds",
  "mergedAccountIds",
] as const;

/** Arrays to string sets; an empty set cannot be stored, so it is left out. */
function toItem(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const sets: ReadonlySet<string> = new Set(SET_FIELDS);
  return Object.fromEntries(
    Object.entries(fields).flatMap(([field, value]) => {
      if (!sets.has(field) || !Array.isArray(value)) return [[field, value]];
      return value.length === 0 ? [] : [[field, new Set(value as string[])]];
    }),
  );
}

/** String sets back to sorted arrays; a missing `identityIds` is an empty list. */
function fromItem(item: Record<string, unknown>): Player {
  const fields: Record<string, unknown> = { ...item, identityIds: item["identityIds"] ?? [] };
  for (const field of SET_FIELDS) {
    const value = fields[field];
    if (value instanceof Set) fields[field] = [...(value as Set<string>)].sort();
  }
  return PlayerSchema.parse(fields);
}

/**
 * PlayerDao over the `AllPlay-Players-<Stage>` table (data-model.md section 4).
 * Reads of the table are strongly consistent, so a player sees their own
 * writes; the `ByEmail` index is eventually consistent, as every GSI is.
 */
export function createDynamoPlayerDao(
  tableName: string,
  client: DocumentSender = documentClient(),
): PlayerDao {
  return {
    get: async (playerId) => {
      const out = (await client.send(
        new GetCommand({ TableName: tableName, Key: { playerId }, ConsistentRead: true }),
      )) as {
        Item?: Record<string, unknown>;
      };
      return out.Item === undefined ? null : fromItem(out.Item);
    },
    create: async (player) => {
      try {
        await client.send(
          new PutCommand({
            TableName: tableName,
            Item: toItem(PlayerSchema.parse(player)),
            ConditionExpression: "attribute_not_exists(playerId)",
          }),
        );
      } catch (error) {
        if (conditionFailed(error)) throw new PlayerExistsError(player.playerId);
        throw error;
      }
    },
    update: async (playerId, changes, at, remove = []) => {
      const expression = updateExpression(toItem({ ...changes, updatedAt: at }), remove);
      try {
        const out = (await client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { playerId },
            ...expression,
            ExpressionAttributeNames: { ...expression.ExpressionAttributeNames, "#pk": "playerId" },
            ConditionExpression: "attribute_exists(#pk)",
            ReturnValues: "ALL_NEW",
          }),
        )) as { Attributes?: Record<string, unknown> };
        return fromItem(out.Attributes ?? {});
      } catch (error) {
        if (conditionFailed(error)) throw new PlayerMissingError(playerId);
        throw error;
      }
    },
    touch: async (playerId, at, ttl) => {
      const stamp = at.toISOString();
      const expression = updateExpression({ lastActiveAt: stamp, updatedAt: stamp, ttl });
      try {
        await client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { playerId },
            ...expression,
            ExpressionAttributeNames: {
              ...expression.ExpressionAttributeNames,
              "#pk": "playerId",
              "#last": "lastActiveAt",
            },
            ExpressionAttributeValues: {
              ...expression.ExpressionAttributeValues,
              ":cutoff": new Date(at.getTime() - TOUCH_INTERVAL_MS).toISOString(),
            },
            ConditionExpression: "attribute_exists(#pk) AND #last <= :cutoff",
          }),
        );
        return true;
      } catch (error) {
        if (conditionFailed(error)) return false;
        throw error;
      }
    },
    listByEmail: async (emailKey) => {
      const matches: EmailMatch[] = [];
      let start: Record<string, unknown> | undefined;
      do {
        const out = (await client.send(
          new QueryCommand({
            TableName: tableName,
            IndexName: "ByEmail",
            KeyConditionExpression: "emailKey = :e",
            ExpressionAttributeValues: { ":e": emailKey },
            ExclusiveStartKey: start,
          }),
        )) as { Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> };
        for (const item of out.Items ?? []) {
          const providers = item["signInProviders"];
          matches.push({
            playerId: item["playerId"] as string,
            status: item["status"] as EmailMatch["status"],
            signInProviders:
              providers instanceof Set
                ? [...(providers as Set<EmailMatch["signInProviders"][number]>)].sort()
                : [],
            createdAt: item["createdAt"] as string,
          });
        }
        start = out.LastEvaluatedKey;
      } while (start !== undefined);
      return matches;
    },
  };
}

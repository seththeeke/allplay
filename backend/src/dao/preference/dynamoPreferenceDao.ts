import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { PreferenceSchema, PreferenceValuesSchema, type Preference } from "../../models/preference";
import { documentClient, updateExpression, type DocumentSender } from "../dynamo";
import type { PreferenceDao } from "./preferenceDao";

/** PreferenceDao over the `AllPlay-Preferences-<Stage>` table (data-model.md section 5). */
export function createDynamoPreferenceDao(
  tableName: string,
  client: DocumentSender = documentClient(),
): PreferenceDao {
  return {
    list: async (playerId) => {
      const items: Preference[] = [];
      let start: Record<string, unknown> | undefined;
      do {
        const out = (await client.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "playerId = :p",
            ConsistentRead: true,
            ExpressionAttributeValues: { ":p": playerId },
            ExclusiveStartKey: start,
          }),
        )) as { Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> };
        items.push(...(out.Items ?? []).map((item) => PreferenceSchema.parse(item)));
        start = out.LastEvaluatedKey;
      } while (start !== undefined);
      return items;
    },
    patch: async (playerId, scope, values, at, ttl) => {
      const expression = updateExpression(
        { ...PreferenceValuesSchema.parse(values), updatedAt: at, ttl },
        [],
        { createdAt: at, entityVersion: 1 },
      );
      const out = (await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { playerId, scope },
          ...expression,
          ReturnValues: "ALL_NEW",
        }),
      )) as { Attributes?: Record<string, unknown> };
      return PreferenceSchema.parse(out.Attributes);
    },
  };
}

import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { conditionFailed, documentClient, type DocumentSender } from "../dynamo";
import type { RateLimitCounterDao } from "./rateLimitCounterDao";

/** RateLimitCounterDao over `AllPlay-RateLimits-<Stage>`: one conditional `ADD` per check (data-model.md section 10). */
export function createDynamoRateLimitCounterDao(
  tableName: string,
  client: DocumentSender = documentClient(),
): RateLimitCounterDao {
  return {
    increment: async (counterKey, limit, ttl) => {
      try {
        await client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { counterKey },
            UpdateExpression: "ADD #count :one SET #ttl = if_not_exists(#ttl, :ttl)",
            ConditionExpression: "attribute_not_exists(counterKey) OR #count < :limit",
            ExpressionAttributeNames: { "#count": "count", "#ttl": "ttl" },
            ExpressionAttributeValues: { ":one": 1, ":ttl": ttl, ":limit": limit },
          }),
        );
        return true;
      } catch (error) {
        if (conditionFailed(error)) return false;
        throw error;
      }
    },
  };
}

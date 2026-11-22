import { PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { MergeTokenSchema } from "../../models/mergeToken";
import { conditionFailed, documentClient, type DocumentSender } from "../dynamo";
import type { MergeTokenDao } from "./mergeTokenDao";

/**
 * MergeTokenDao over `AllPlay-MergeTokens-<Stage>` (data-model.md section 9).
 * Expiry is checked in the redemption condition, because DynamoDB deletes
 * expired items only eventually.
 */
export function createDynamoMergeTokenDao(
  tableName: string,
  client: DocumentSender = documentClient(),
): MergeTokenDao {
  return {
    create: async (token) => {
      await client.send(
        new PutCommand({
          TableName: tableName,
          Item: MergeTokenSchema.parse(token),
          ConditionExpression: "attribute_not_exists(tokenHash)",
        }),
      );
    },
    redeem: async (tokenHash, redeemedBy, at, nowSeconds) => {
      try {
        const out = (await client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { tokenHash },
            UpdateExpression: "SET #status = :redeemed, redeemedBy = :me, updatedAt = :at",
            ConditionExpression:
              "attribute_exists(tokenHash) AND #ttl > :now AND (#status = :issued OR redeemedBy = :me)",
            ExpressionAttributeNames: { "#status": "status", "#ttl": "ttl" },
            ExpressionAttributeValues: {
              ":redeemed": "REDEEMED",
              ":issued": "ISSUED",
              ":me": redeemedBy,
              ":at": at,
              ":now": nowSeconds,
            },
            ReturnValues: "ALL_NEW",
          }),
        )) as { Attributes?: Record<string, unknown> };
        return MergeTokenSchema.parse(out.Attributes);
      } catch (error) {
        if (conditionFailed(error)) return null;
        throw error;
      }
    },
  };
}

import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { SystemFlagSchema } from "../../models/systemFlag";
import { documentClient, updateExpression, type DocumentSender } from "../dynamo";
import type { SystemFlagDao } from "./systemFlagDao";

/** SystemFlagDao over `AllPlay-SystemFlags-<Stage>` (data-model.md section 14). */
export function createDynamoSystemFlagDao(
  tableName: string,
  client: DocumentSender = documentClient(),
): SystemFlagDao {
  return {
    get: async (flagId) => {
      const out = (await client.send(
        new GetCommand({ TableName: tableName, Key: { flagId }, ConsistentRead: true }),
      )) as { Item?: Record<string, unknown> };
      return out.Item === undefined ? null : SystemFlagSchema.parse(out.Item);
    },
    put: async (flag) => {
      const { flagId, createdAt, ...rest } = SystemFlagSchema.parse(flag);
      /* A flag without changedBy (a budget pull) clears the admin who last changed it. */
      const remove = rest.changedBy === undefined ? ["changedBy"] : [];
      const out = (await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { flagId },
          ...updateExpression(rest, remove, { createdAt }),
          ReturnValues: "ALL_NEW",
        }),
      )) as { Attributes?: Record<string, unknown> };
      return SystemFlagSchema.parse(out.Attributes);
    },
  };
}

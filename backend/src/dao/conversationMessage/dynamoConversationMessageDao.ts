import { BatchWriteCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { ConversationMessageSchema } from "../../models/conversationMessage";
import { conditionFailed, documentClient, type DocumentSender } from "../dynamo";
import type { ConversationMessageDao } from "./conversationMessageDao";

const BATCH_SIZE = 25;
const MAX_BATCH_ATTEMPTS = 5;

const PageSchema = z.object({
  Items: z.array(z.unknown()).optional(),
  LastEvaluatedKey: z.record(z.string(), z.unknown()).optional(),
});

const BatchResultSchema = z.object({
  UnprocessedItems: z.record(z.string(), z.array(z.unknown())).optional(),
});

type DeleteRequest = { DeleteRequest: { Key: { sessionId: string; messageId: string } } };

/** ConversationMessageDao over `AllPlay-ConversationMessages-<Stage>` (conversational-ai.md section 6). */
export function createDynamoConversationMessageDao(
  tableName: string,
  client: DocumentSender = documentClient(),
): ConversationMessageDao {
  const list: ConversationMessageDao["list"] = async (sessionId) => {
    const messages = [];
    let start: Record<string, unknown> | undefined;
    do {
      const page = PageSchema.parse(
        await client.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "sessionId = :sessionId",
            ExpressionAttributeValues: { ":sessionId": sessionId },
            ConsistentRead: true,
            ...(start === undefined ? {} : { ExclusiveStartKey: start }),
          }),
        ),
      );
      messages.push(...(page.Items ?? []).map((item) => ConversationMessageSchema.parse(item)));
      start = page.LastEvaluatedKey;
    } while (start !== undefined);
    return messages;
  };

  /* DynamoDB may hand back part of a batch under load, so the remainder is sent again. */
  const writeBatch = async (requests: DeleteRequest[]): Promise<void> => {
    let pending: unknown[] = requests;
    for (let attempt = 0; pending.length > 0; attempt += 1) {
      if (attempt >= MAX_BATCH_ATTEMPTS)
        throw new Error("The conversation could not be fully deleted.");
      const result = BatchResultSchema.parse(
        await client.send(
          new BatchWriteCommand({ RequestItems: { [tableName]: pending as never } }),
        ),
      );
      pending = result.UnprocessedItems?.[tableName] ?? [];
    }
  };

  return {
    append: async (message) => {
      await client.send(new PutCommand({ TableName: tableName, Item: message }));
    },
    list,
    refreshTtl: async (sessionId, ttl, updatedAt) => {
      for (const { messageId } of await list(sessionId)) {
        try {
          await client.send(
            new UpdateCommand({
              TableName: tableName,
              Key: { sessionId, messageId },
              UpdateExpression: "SET #ttl = :ttl, updatedAt = :updatedAt",
              ConditionExpression: "attribute_exists(messageId)",
              ExpressionAttributeNames: { "#ttl": "ttl" },
              ExpressionAttributeValues: { ":ttl": ttl, ":updatedAt": updatedAt },
            }),
          );
        } catch (error) {
          /* A message that expired between the read and this write must not come back. */
          if (!conditionFailed(error)) throw error;
        }
      }
    },
    deleteAll: async (sessionId) => {
      const requests = (await list(sessionId)).map(({ messageId }): DeleteRequest => ({
        DeleteRequest: { Key: { sessionId, messageId } },
      }));
      for (let index = 0; index < requests.length; index += BATCH_SIZE)
        await writeBatch(requests.slice(index, index + BATCH_SIZE));
    },
  };
}

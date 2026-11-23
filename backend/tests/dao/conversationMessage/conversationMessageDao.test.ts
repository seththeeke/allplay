import { describe, expect, it } from "vitest";
import { createDynamoConversationMessageDao } from "../../../src/dao/conversationMessage/dynamoConversationMessageDao";
import { createInMemoryConversationMessageDao } from "../../../src/dao/conversationMessage/inMemoryConversationMessageDao";
import { conditionalCheckFailed, stubDynamo } from "../dynamoStub";
import {
  conversationMessage,
  conversationMessageDaoContract,
} from "./conversationMessageDaoContract";

const TABLE = "AllPlay-ConversationMessages-Test";

describe("in-memory conversation messages", () => {
  conversationMessageDaoContract(() => createInMemoryConversationMessageDao());

  it("replaces a message written again with the same id", async () => {
    const dao = createInMemoryConversationMessageDao();
    await dao.append(conversationMessage("s", "01A"));
    await dao.append(conversationMessage("s", "01A", { text: "Done." }));
    expect((await dao.list("s")).map((message) => message.text)).toEqual(["Done."]);
  });
});

describe("DynamoConversationMessageDao", () => {
  it("writes a message and reads every page with a consistent query", async () => {
    const first = conversationMessage("s", "01A");
    const second = conversationMessage("s", "01B");
    const stub = stubDynamo(
      {},
      { Items: [first], LastEvaluatedKey: { sessionId: "s", messageId: "01A" } },
      { Items: [second] },
      {},
    );
    const dao = createDynamoConversationMessageDao(TABLE, stub);
    await dao.append(first);
    expect(stub.sent[0]).toEqual({
      command: "PutCommand",
      input: { TableName: TABLE, Item: first },
    });
    expect(await dao.list("s")).toEqual([first, second]);
    expect(stub.sent[1]?.input).toMatchObject({ TableName: TABLE, ConsistentRead: true });
    expect(stub.sent[2]?.input).toMatchObject({
      ExclusiveStartKey: { sessionId: "s", messageId: "01A" },
    });
    expect(await dao.list("empty")).toEqual([]);
  });

  it("refreshes each expiry and never recreates a message that has gone", async () => {
    const stub = stubDynamo(
      { Items: [conversationMessage("s", "01A"), conversationMessage("s", "01B")] },
      {},
      conditionalCheckFailed(),
    );
    await createDynamoConversationMessageDao(TABLE, stub).refreshTtl(
      "s",
      99,
      "2026-11-23T00:00:00.000Z",
    );
    expect(stub.sent[1]).toEqual({
      command: "UpdateCommand",
      input: {
        TableName: TABLE,
        Key: { sessionId: "s", messageId: "01A" },
        UpdateExpression: "SET #ttl = :ttl, updatedAt = :updatedAt",
        ConditionExpression: "attribute_exists(messageId)",
        ExpressionAttributeNames: { "#ttl": "ttl" },
        ExpressionAttributeValues: { ":ttl": 99, ":updatedAt": "2026-11-23T00:00:00.000Z" },
      },
    });
    expect(stub.sent).toHaveLength(3);
  });

  it("passes on a refresh failure that is not a missing message", async () => {
    const stub = stubDynamo({ Items: [conversationMessage("s", "01A")] }, new Error("down"));
    await expect(
      createDynamoConversationMessageDao(TABLE, stub).refreshTtl(
        "s",
        99,
        "2026-11-23T00:00:00.000Z",
      ),
    ).rejects.toThrow("down");
  });

  it("deletes in batches of 25 and resends what DynamoDB left unprocessed", async () => {
    const items = Array.from({ length: 26 }, (_, index) =>
      conversationMessage("s", `01${String(index).padStart(3, "0")}`),
    );
    const left = {
      DeleteRequest: { Key: { sessionId: "s", messageId: "01000" } },
    };
    const stub = stubDynamo({ Items: items }, { UnprocessedItems: { [TABLE]: [left] } }, {}, {});
    await createDynamoConversationMessageDao(TABLE, stub).deleteAll("s");
    const batches = stub.sent
      .slice(1)
      .map(
        (sent) => (sent.input as { RequestItems: Record<string, unknown[]> }).RequestItems[TABLE],
      );
    expect(batches.map((batch) => batch?.length)).toEqual([25, 1, 1]);
    expect(batches[1]).toEqual([left]);
  });

  it("stops with an error when a batch never completes", async () => {
    const left = { DeleteRequest: { Key: { sessionId: "s", messageId: "01A" } } };
    const unprocessed = { UnprocessedItems: { [TABLE]: [left] } };
    const stub = stubDynamo(
      { Items: [conversationMessage("s", "01A")] },
      unprocessed,
      unprocessed,
      unprocessed,
      unprocessed,
      unprocessed,
    );
    await expect(createDynamoConversationMessageDao(TABLE, stub).deleteAll("s")).rejects.toThrow(
      "could not be fully deleted",
    );
  });
});

import { describe, expect, it } from "vitest";
import { createDynamoSystemFlagDao } from "../../../src/dao/systemFlag/dynamoSystemFlagDao";
import { stubDynamo } from "../dynamoStub";
import { andonFlag } from "./systemFlagDaoContract";

const TABLE = "AllPlay-SystemFlags-Test";
const AT = "2026-11-28T10:00:00.000Z";

describe("DynamoSystemFlagDao", () => {
  it("reads the flag consistently, and a missing item as null", async () => {
    const flag = andonFlag(true, AT);
    const stub = stubDynamo({ Item: flag }, {});
    const dao = createDynamoSystemFlagDao(TABLE, stub);
    expect(await dao.get("ANDON")).toEqual(flag);
    expect(await dao.get("ANDON")).toBeNull();
    expect(stub.sent[0]).toMatchObject({
      command: "GetCommand",
      input: { TableName: TABLE, Key: { flagId: "ANDON" }, ConsistentRead: true },
    });
  });

  it("updates the flag, keeping createdAt and clearing changedBy on a budget pull", async () => {
    const flag = andonFlag(true, AT);
    const stub = stubDynamo({ Attributes: flag }, { Attributes: andonFlag(false, AT, "ACCT#a") });
    const dao = createDynamoSystemFlagDao(TABLE, stub);
    expect(await dao.put(flag)).toEqual(flag);
    const input = stub.sent[0]?.input as { UpdateExpression: string; Key: unknown };
    expect(input.Key).toEqual({ flagId: "ANDON" });
    expect(input.UpdateExpression).toContain("if_not_exists");
    expect(input.UpdateExpression).toContain("REMOVE");
    await dao.put(andonFlag(false, AT, "ACCT#a"));
    expect((stub.sent[1]?.input as { UpdateExpression: string }).UpdateExpression).not.toContain(
      "REMOVE",
    );
  });
});

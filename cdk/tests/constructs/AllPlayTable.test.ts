import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { AwsSolutionsChecks } from "cdk-nag";
import { describe, expect, it } from "vitest";
import type { StageName } from "../../lib/config";
import { AllPlayTable, type AllPlayTableProps } from "../../lib/constructs/AllPlayTable";

function synth(stage: StageName, overrides: Partial<AllPlayTableProps> = {}) {
  const app = new App();
  const stack = new Stack(app, `TableStack${stage}`);
  new AllPlayTable(stack, "Players", {
    stage,
    entity: "Players",
    partitionKey: { name: "playerId" },
    ...overrides,
  });
  return { app, stack, template: Template.fromStack(stack) };
}

describe("AllPlayTable", () => {
  it("creates an on-demand, stage-named table that is retained on deletion", () => {
    const { template } = synth("Test");
    template.hasResource("AWS::DynamoDB::GlobalTable", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
      Properties: Match.objectLike({
        TableName: "AllPlay-Players-Test",
        BillingMode: "PAY_PER_REQUEST",
        KeySchema: [{ AttributeName: "playerId", KeyType: "HASH" }],
        AttributeDefinitions: [{ AttributeName: "playerId", AttributeType: "S" }],
      }),
    });
  });

  it("disables point-in-time recovery and deletion protection in Test", () => {
    const { template } = synth("Test");
    template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      Replicas: [
        Match.objectLike({
          DeletionProtectionEnabled: false,
          PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: false },
        }),
      ],
    });
  });

  it("enables point-in-time recovery and deletion protection in Prod", () => {
    const { template } = synth("Prod");
    template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      TableName: "AllPlay-Players-Prod",
      Replicas: [
        Match.objectLike({
          DeletionProtectionEnabled: true,
          PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
        }),
      ],
    });
  });

  it("supports a sort key, TTL and every GSI projection type", () => {
    const { template } = synth("Test", {
      entity: "Decisions",
      sortKey: { name: "createdAt" },
      timeToLiveAttribute: "ttl",
      globalIndexes: [
        {
          indexName: "ByPlayer",
          partitionKey: { name: "playerId" },
          sortKey: { name: "createdAt" },
          projection: { include: ["outcome"] },
        },
        { indexName: "ByDayOutcome", partitionKey: { name: "dayOutcomeKey" }, projection: "ALL" },
        {
          indexName: "ByVersion",
          partitionKey: { name: "gameId" },
          sortKey: { name: "version", type: "NUMBER" },
          projection: "KEYS_ONLY",
        },
      ],
    });
    template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      TableName: "AllPlay-Decisions-Test",
      KeySchema: [
        { AttributeName: "playerId", KeyType: "HASH" },
        { AttributeName: "createdAt", KeyType: "RANGE" },
      ],
      TimeToLiveSpecification: { AttributeName: "ttl", Enabled: true },
      GlobalSecondaryIndexes: [
        {
          IndexName: "ByPlayer",
          KeySchema: [
            { AttributeName: "playerId", KeyType: "HASH" },
            { AttributeName: "createdAt", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "INCLUDE", NonKeyAttributes: ["outcome"] },
        },
        {
          IndexName: "ByDayOutcome",
          KeySchema: [{ AttributeName: "dayOutcomeKey", KeyType: "HASH" }],
          Projection: { ProjectionType: "ALL" },
        },
        {
          IndexName: "ByVersion",
          KeySchema: [
            { AttributeName: "gameId", KeyType: "HASH" },
            { AttributeName: "version", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "KEYS_ONLY" },
        },
      ],
      AttributeDefinitions: Match.arrayWith([{ AttributeName: "version", AttributeType: "N" }]),
    });
  });

  it.each(["Test", "Prod"] as const)("passes cdk-nag AwsSolutions checks in %s", (stage) => {
    const { app, stack } = synth(stage);
    const report = new AwsSolutionsChecks(app).validateScope(stack);
    expect(report.violations).toEqual([]);
    expect(report.success).toBe(true);
  });
});

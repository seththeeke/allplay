import { Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { FEDERATION_FIELDS, PENDING } from "../../lib/constructs/FederationSecret";
import { AllPlayStage } from "../../lib/stage";
import { WEB_FIXTURE, testApp } from "../testApp";

function synth(stageName: "Test" | "Prod") {
  const stage = new AllPlayStage(testApp(), stageName, {
    stageName,
    webAssetPath: WEB_FIXTURE,
    env: { region: "us-east-1" },
  });
  return { stage, template: Template.fromStack(stage.stateful) };
}

describe("AllPlayStatefulStack", () => {
  it("creates the stage's federation secret with placeholders only, retained on delete", () => {
    for (const stageName of ["Test", "Prod"] as const) {
      const { template } = synth(stageName);
      const secrets = template.findResources("AWS::SecretsManager::Secret");
      const [secret] = Object.values(secrets) as {
        Properties: { Name: string; SecretString: string };
        DeletionPolicy: string;
      }[];
      expect(Object.keys(secrets)).toHaveLength(1);
      expect(secret?.Properties.Name).toBe(`allplay/${stageName.toLowerCase()}/federation`);
      expect(JSON.parse(secret?.Properties.SecretString ?? "{}")).toEqual(
        Object.fromEntries(FEDERATION_FIELDS.map((field) => [field, PENDING])),
      );
      expect(secret?.DeletionPolicy).toBe("Retain");
    }
  });

  it("resolves fields from the secret at deploy time", () => {
    const { stage } = synth("Test");
    const resolved = JSON.stringify(
      stage.stateful.resolve(stage.stateful.federation.field("appleTeamId").unsafeUnwrap()),
    );
    expect(resolved).toContain("resolve:secretsmanager");
    expect(resolved).toContain("appleTeamId");
  });

  it("creates the Players table with guest TTL and the ByEmail index, and Preferences by scope", () => {
    const { template } = synth("Test");
    template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      TableName: "AllPlay-Players-Test",
      KeySchema: [{ AttributeName: "playerId", KeyType: "HASH" }],
      TimeToLiveSpecification: { AttributeName: "ttl", Enabled: true },
      GlobalSecondaryIndexes: [
        Match.objectLike({
          IndexName: "ByEmail",
          KeySchema: [
            { AttributeName: "emailKey", KeyType: "HASH" },
            { AttributeName: "createdAt", KeyType: "RANGE" },
          ],
          Projection: {
            ProjectionType: "INCLUDE",
            NonKeyAttributes: ["status", "signInProviders"],
          },
        }),
      ],
    });
    template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      TableName: "AllPlay-Preferences-Test",
      KeySchema: [
        { AttributeName: "playerId", KeyType: "HASH" },
        { AttributeName: "scope", KeyType: "RANGE" },
      ],
      TimeToLiveSpecification: { AttributeName: "ttl", Enabled: true },
    });
    template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      TableName: "AllPlay-MergeTokens-Test",
      KeySchema: [{ AttributeName: "tokenHash", KeyType: "HASH" }],
      TimeToLiveSpecification: { AttributeName: "ttl", Enabled: true },
    });
    expect(Object.keys(template.findOutputs("*"))).toEqual(
      expect.arrayContaining(["PlayersTableName", "PreferencesTableName", "MergeTokensTableName"]),
    );
  });

  it("creates the game tables: sessions, seats with the resume index, and stats, each with the guest TTL", () => {
    const { template } = synth("Test");
    template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      TableName: "AllPlay-GameSessions-Test",
      KeySchema: [{ AttributeName: "sessionId", KeyType: "HASH" }],
      TimeToLiveSpecification: { AttributeName: "ttl", Enabled: true },
    });
    template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      TableName: "AllPlay-SeatAssignments-Test",
      KeySchema: [
        { AttributeName: "playerId", KeyType: "HASH" },
        { AttributeName: "sessionId", KeyType: "RANGE" },
      ],
      TimeToLiveSpecification: { AttributeName: "ttl", Enabled: true },
      GlobalSecondaryIndexes: [
        Match.objectLike({
          IndexName: "ByPlayerGame",
          KeySchema: [
            { AttributeName: "playerGameKey", KeyType: "HASH" },
            { AttributeName: "statusSortKey", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "ALL" },
        }),
      ],
    });
    template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      TableName: "AllPlay-PlayerStats-Test",
      KeySchema: [
        { AttributeName: "playerId", KeyType: "HASH" },
        { AttributeName: "statsKey", KeyType: "RANGE" },
      ],
      TimeToLiveSpecification: { AttributeName: "ttl", Enabled: true },
    });
    template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      TableName: "AllPlay-MetricRollups-Test",
      KeySchema: [
        { AttributeName: "rollupType", KeyType: "HASH" },
        { AttributeName: "period", KeyType: "RANGE" },
      ],
    });
    template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      TableName: "AllPlay-RateLimits-Test",
      KeySchema: [{ AttributeName: "counterKey", KeyType: "HASH" }],
      TimeToLiveSpecification: { AttributeName: "ttl", Enabled: true },
    });
    expect(Object.keys(template.findOutputs("*"))).toEqual(
      expect.arrayContaining([
        "RateLimitsTableName",
        "MetricRollupsTableName",
        "GameSessionsTableName",
        "SeatAssignmentsTableName",
        "PlayerStatsTableName",
      ]),
    );
  });

  it("grants Test's verification read and write on its tables, and Prod's nothing", () => {
    const test = synth("Test").stage;
    const scope = new Stack(undefined, "Grants", {
      env: { account: "111111111111", region: "us-east-1" },
    });
    const statements = test.verifyGrants.map(
      (grant) =>
        scope.resolve(grant(scope).toStatementJson()) as { Resource: string[]; Action: string[] },
    );
    expect(statements).toHaveLength(3);
    const tables = statements.find((statement) => statement.Action.includes("dynamodb:PutItem"));
    const assume = statements.find((statement) => String(statement.Action) === "sts:AssumeRole");
    const scan = statements.find((statement) => String(statement.Action) === "dynamodb:Scan");
    expect(JSON.stringify(scan?.Resource)).toContain(
      ":dynamodb:us-east-1:111111111111:table/AllPlay-Players-Test/index/ByEmail",
    );
    expect(JSON.stringify(scan?.Resource)).toContain(
      ':dynamodb:us-east-1:111111111111:table/AllPlay-Players-Test"',
    );
    /* ARNs carry the partition as a CloudFormation reference; compare the rest. */
    const arns = JSON.stringify(tables?.Resource);
    for (const suffix of [
      ':dynamodb:us-east-1:111111111111:table/AllPlay-Players-Test"',
      ':dynamodb:us-east-1:111111111111:table/AllPlay-Players-Test/index/ByEmail"',
      ':dynamodb:us-east-1:111111111111:table/AllPlay-Preferences-Test"',
      ':dynamodb:us-east-1:111111111111:table/AllPlay-GameSessions-Test"',
      ':dynamodb:us-east-1:111111111111:table/AllPlay-SeatAssignments-Test"',
      ':dynamodb:us-east-1:111111111111:table/AllPlay-SeatAssignments-Test/index/ByPlayerGame"',
      ':dynamodb:us-east-1:111111111111:table/AllPlay-PlayerStats-Test"',
      ':dynamodb:us-east-1:111111111111:table/AllPlay-RateLimits-Test"',
      ':dynamodb:us-east-1:111111111111:table/AllPlay-MetricRollups-Test"',
    ])
      expect(arns).toContain(suffix);
    expect(arns).not.toContain("*");
    expect(arns).toContain(':dynamodb:us-east-1:111111111111:table/AllPlay-MergeTokens-Test"');
    /* Test accounts are managed through one named role, assumed without a wildcard. */
    expect(JSON.stringify(assume?.Resource)).toContain(
      ":iam::111111111111:role/AllPlay-IntegrationAccounts-Test",
    );
    expect(synth("Prod").stage.verifyGrants).toEqual([]);
  });

  it("keeps the integration accounts role to Test, scoped to its pool's account calls", () => {
    const { template } = synth("Test");
    template.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "AllPlay-IntegrationAccounts-Test",
    });
    const policies = JSON.stringify(template.findResources("AWS::IAM::Policy"));
    expect(policies).toContain(
      '"cognito-idp:AdminAddUserToGroup","cognito-idp:AdminCreateUser","cognito-idp:AdminDeleteUser","cognito-idp:AdminSetUserPassword"',
    );
    expect(Object.keys(template.findOutputs("*"))).toContain("UserPoolId");
    expect(JSON.stringify(synth("Prod").template.toJSON())).not.toContain("IntegrationAccounts");
  });
});

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

  it("grants Test's verification read and write on its tables, and Prod's nothing", () => {
    const test = synth("Test").stage;
    const scope = new Stack(undefined, "Grants", {
      env: { account: "111111111111", region: "us-east-1" },
    });
    const statements = test.verifyGrants.map(
      (grant) =>
        scope.resolve(grant(scope).toStatementJson()) as { Resource: string[]; Action: string[] },
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]?.Action).toContain("dynamodb:PutItem");
    /* ARNs carry the partition as a CloudFormation reference; compare the rest. */
    const arns = JSON.stringify(statements[0]?.Resource);
    for (const suffix of [
      ':dynamodb:us-east-1:111111111111:table/AllPlay-Players-Test"',
      ':dynamodb:us-east-1:111111111111:table/AllPlay-Players-Test/index/ByEmail"',
      ':dynamodb:us-east-1:111111111111:table/AllPlay-Preferences-Test"',
    ])
      expect(arns).toContain(suffix);
    expect(arns).not.toContain("*");
    expect(synth("Prod").stage.verifyGrants).toEqual([]);
  });
});

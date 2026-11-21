import { Template } from "aws-cdk-lib/assertions";
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
});

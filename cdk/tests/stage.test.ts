import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { AllPlayStage } from "../lib/stage";

function build(stageName: "Test" | "Prod") {
  const app = new App();
  return new AllPlayStage(app, stageName, { stageName, env: { region: "us-east-1" } });
}

describe("AllPlayStage", () => {
  it("creates the stateful and app stacks with stage names", () => {
    const stage = build("Test");
    expect(stage.stateful.stackName).toBe("AllPlayStateful-Test");
    expect(stage.app.stackName).toBe("AllPlayApp-Test");
    expect(stage.stateful.stage).toBe("Test");
    expect(stage.app.stage).toBe("Test");
  });

  it("makes the app stack depend on the stateful stack, never the reverse", () => {
    const stage = build("Test");
    expect(stage.app.dependencies).toContain(stage.stateful);
    expect(stage.stateful.dependencies).toEqual([]);
  });

  it("protects the Prod stateful stack from termination only", () => {
    expect(build("Prod").stateful.terminationProtection).toBe(true);
    expect(build("Test").stateful.terminationProtection).toBe(false);
    expect(build("Prod").app.terminationProtection).toBe(false);
  });

  it("tags every stack with the project and stage", () => {
    const stage = build("Prod");
    Template.fromStack(stage.app);
    expect(stage.stateful.tags.tagValues()).toEqual({ Project: "AllPlay", Stage: "Prod" });
    expect(stage.app.tags.tagValues()).toEqual({ Project: "AllPlay", Stage: "Prod" });
  });
});

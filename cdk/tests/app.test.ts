import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../lib/app";

describe("buildApp", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("creates the pipeline stack and one stage per stage name in us-east-1", () => {
    const app = new App();
    const { pipeline, stages } = buildApp(app);
    expect(pipeline.stackName).toBe("AllPlayPipeline");
    expect(pipeline.region).toBe("us-east-1");
    expect(stages.map((stage) => stage.stageName)).toEqual(["Test", "Prod"]);
    expect(stages.map((stage) => stage.region)).toEqual(["us-east-1", "us-east-1"]);
  });

  it("honors a region from context", () => {
    const app = new App({ context: { "allplay:region": "us-west-2" } });
    expect(buildApp(app).pipeline.region).toBe("us-west-2");
  });

  it("synthesizes every stack without credentials and with no cdk-nag errors", () => {
    const app = new App({ outdir: mkdtempSync(join(tmpdir(), "allplay-cdk-")) });
    const { pipeline, stages } = buildApp(app);
    const assembly = app.synth();
    const stacks = [pipeline, ...stages.flatMap((stage) => [stage.stateful, stage.app])];
    const checks = new AwsSolutionsChecks(app);
    for (const stack of stacks) {
      expect(checks.validateScope(stack).violations).toEqual([]);
    }
    expect(assembly.stacks.map((stack) => stack.stackName)).toEqual(["AllPlayPipeline"]);
    expect(stages[0]?.synth().stacks.map((stack) => stack.stackName)).toEqual([
      "AllPlayStateful-Test",
      "AllPlayApp-Test",
    ]);
  });

  it("is what bin/app.ts runs", async () => {
    vi.stubEnv("CDK_OUTDIR", mkdtempSync(join(tmpdir(), "allplay-bin-")));
    await expect(import("../bin/app")).resolves.toBeDefined();
  });
});

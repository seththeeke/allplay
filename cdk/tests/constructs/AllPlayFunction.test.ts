import { Duration, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { AwsSolutionsChecks } from "cdk-nag";
import { describe, expect, it } from "vitest";
import type { StageName } from "../../lib/config";
import { AllPlayFunction, bundledFileCommands } from "../../lib/constructs/AllPlayFunction";
import { testApp } from "../testApp";

function synth(stage: StageName, environment?: Record<string, string>) {
  const app = testApp();
  const stack = new Stack(app, `FunctionStack${stage}`, { env: { region: "us-east-1" } });
  const fn = new AllPlayFunction(stack, "HealthApi", {
    stage,
    name: "HealthApi",
    entry: "controller/web-api/health/handler.ts",
    memorySize: 256,
    timeout: Duration.seconds(5),
    ...(environment === undefined ? {} : { environment }),
  });
  return { app, stack, fn, template: Template.fromStack(stack) };
}

describe("AllPlayFunction", () => {
  it("names an account-wide Lambda without the stage, and sets no STAGE", () => {
    const app = testApp();
    const stack = new Stack(app, "AccountWide", { env: { region: "us-east-1" } });
    new AllPlayFunction(stack, "AndonCord", {
      stage: "Prod",
      accountWide: true,
      name: "AndonCord",
      entry: "controller/alerts/andonCordHandler.ts",
      memorySize: 256,
      timeout: Duration.seconds(30),
    });
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "AllPlay-AndonCord",
      Environment: { Variables: Match.objectLike({ LOG_LEVEL: "INFO" }) },
    });
    expect(JSON.stringify(template.toJSON())).not.toContain('"STAGE"');
  });

  it("copies bundled files from the backend source beside the handler", () => {
    expect(bundledFileCommands(["service/a/file.md"], "/backend", "/out")).toEqual([
      'cp "/backend/src/service/a/file.md" "/out/"',
    ]);
    const app = testApp();
    const stack = new Stack(app, "BundledFiles", { env: { region: "us-east-1" } });
    new AllPlayFunction(stack, "HealthApi", {
      stage: "Test",
      name: "HealthApi",
      entry: "controller/web-api/health/handler.ts",
      memorySize: 256,
      timeout: Duration.seconds(5),
      bundledFiles: ["service/conversation/personality/game-speaker.md"],
    });
    Template.fromStack(stack).resourceCountIs("AWS::Lambda::Function", 1);
  });

  it("creates a stage-named Node.js 22 arm64 function with JSON logs", () => {
    const { template } = synth("Test");
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "AllPlay-HealthApi-Test",
      Runtime: "nodejs22.x",
      Architectures: ["arm64"],
      MemorySize: 256,
      Timeout: 5,
      Handler: "index.handler",
      LoggingConfig: Match.objectLike({ LogFormat: "JSON", ApplicationLogLevel: "DEBUG" }),
      Environment: {
        Variables: { STAGE: "Test", LOG_LEVEL: "DEBUG", NODE_OPTIONS: "--enable-source-maps" },
      },
    });
  });

  it("logs at INFO in Prod and merges extra environment variables", () => {
    const { template } = synth("Prod", { EXTRA: "1" });
    template.hasResourceProperties("AWS::Lambda::Function", {
      LoggingConfig: Match.objectLike({ ApplicationLogLevel: "INFO" }),
      Environment: { Variables: Match.objectLike({ LOG_LEVEL: "INFO", EXTRA: "1" }) },
    });
  });

  it("keeps logs 14 days in its own log group and grants writes only there", () => {
    const { template } = synth("Test");
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: "/aws/lambda/AllPlay-HealthApi-Test",
      RetentionInDays: 14,
    });
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: [
          Match.objectLike({
            Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
            Resource: { "Fn::GetAtt": [Match.stringLikeRegexp("HealthApiLogs"), "Arn"] },
          }),
        ],
      },
    });
    template.hasResourceProperties("AWS::IAM::Role", { ManagedPolicyArns: Match.absent() });
  });

  it("passes cdk-nag", () => {
    const { stack } = synth("Test");
    expect(new AwsSolutionsChecks().validateScope(stack).violations).toEqual([]);
  });
});

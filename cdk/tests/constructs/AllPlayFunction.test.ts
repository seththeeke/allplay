import { Duration, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { AwsSolutionsChecks } from "cdk-nag";
import { describe, expect, it } from "vitest";
import type { StageName } from "../../lib/config";
import { AllPlayFunction } from "../../lib/constructs/AllPlayFunction";
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

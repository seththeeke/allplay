import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { AllPlayStage } from "../../lib/stage";
import { WEB_FIXTURE, testApp } from "../testApp";

describe("metrics rollup", () => {
  const app = Template.fromStack(
    new AllPlayStage(testApp(), "Test", {
      stageName: "Test",
      webAssetPath: WEB_FIXTURE,
      env: { region: "us-east-1" },
    }).app,
  );

  it("runs AllPlay-MetricsRollup daily at 00:15 UTC with retries and a dead-letter queue", () => {
    app.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "AllPlay-MetricsRollup-Test",
      MemorySize: 512,
      Timeout: 300,
      Environment: {
        Variables: Match.objectLike({
          PLAYERS_TABLE: Match.anyValue(),
          METRIC_ROLLUPS_TABLE: Match.anyValue(),
        }),
      },
    });
    app.hasResourceProperties("AWS::Scheduler::Schedule", {
      Name: "AllPlay-MetricsRollup-Test",
      ScheduleExpression: "cron(15 0 * * ? *)",
      ScheduleExpressionTimezone: "Etc/UTC",
      Target: Match.objectLike({
        RetryPolicy: { MaximumRetryAttempts: 3, MaximumEventAgeInSeconds: 7200 },
        DeadLetterConfig: Match.objectLike({ Arn: Match.anyValue() }),
      }),
    });
    app.hasResourceProperties("AWS::SQS::Queue", {
      QueueName: "AllPlay-MetricsRollupDeadLetters-Test",
    });
  });

  it("lets the rollup scan only the players and write only the rollups", () => {
    const statements = Object.entries(app.findResources("AWS::IAM::Policy"))
      .filter(([logicalId]) => logicalId.startsWith("MetricsRollup"))
      .flatMap(
        ([, value]) =>
          (value as { Properties: { PolicyDocument: { Statement: unknown[] } } }).Properties
            .PolicyDocument.Statement,
      )
      .map((statement) => JSON.stringify(statement));
    const scan = statements.find((statement) => statement.includes("dynamodb:Scan")) ?? "";
    expect(scan).toContain("Players");
    expect(scan).not.toContain("index");
    expect(statements.join()).not.toContain("DeleteItem");
  });

  it("alarms on a failed run and on a dead letter", () => {
    for (const name of [
      "AllPlay-MetricsRollupErrors-Test",
      "AllPlay-MetricsRollupDeadLetters-Test",
    ])
      app.hasResourceProperties("AWS::CloudWatch::Alarm", { AlarmName: name, Threshold: 1 });
  });
});

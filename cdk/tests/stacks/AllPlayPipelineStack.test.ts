import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { buildApp } from "../../lib/app";
import {
  ALERT_EMAIL,
  CONNECTION_PARAMETER,
  SYNTH_COMMANDS,
  verifyCommands,
} from "../../lib/stacks/AllPlayPipelineStack";
import { testApp } from "../testApp";

function synth() {
  const { pipeline } = buildApp(testApp());
  return { pipeline, template: Template.fromStack(pipeline) };
}

describe("AllPlayPipelineStack", () => {
  const { pipeline, template } = synth();

  it("is a V2 pipeline named AllPlay sourced from GitHub without push triggers", () => {
    template.hasResourceProperties("AWS::CodePipeline::Pipeline", {
      Name: "AllPlay",
      PipelineType: "V2",
      Stages: Match.arrayWith([
        Match.objectLike({
          Name: "Source",
          Actions: [
            Match.objectLike({
              ActionTypeId: Match.objectLike({ Provider: "CodeStarSourceConnection" }),
              Configuration: Match.objectLike({
                FullRepositoryId: "seththeeke/allplay",
                BranchName: "main",
                DetectChanges: false,
                ConnectionArn: { Ref: Match.stringLikeRegexp("SsmParameterValue") },
              }),
            }),
          ],
        }),
      ]),
    });
    expect(JSON.stringify(template.toJSON().Parameters)).toContain(CONNECTION_PARAMETER);
  });

  it("orders stages: build, self-mutate, assets, Test, Prod", () => {
    const [resource] = Object.values(template.findResources("AWS::CodePipeline::Pipeline")) as {
      Properties: { Stages: { Name: string }[] };
    }[];
    const stages = resource?.Properties.Stages ?? [];
    expect(stages.map((stage) => stage.Name)).toEqual([
      "Source",
      "Build",
      "UpdatePipeline",
      "Assets",
      "Test",
      "Prod",
    ]);
  });

  it("lints, tests and builds every package before synth, on small ARM Node 22 builds", () => {
    expect(SYNTH_COMMANDS).toEqual(
      expect.arrayContaining(["npm run lint", "npm test", "npm run build"]),
    );
    template.hasResourceProperties("AWS::CodeBuild::Project", {
      Environment: Match.objectLike({
        Type: "ARM_CONTAINER",
        ComputeType: "BUILD_GENERAL1_SMALL",
        Image: "aws/codebuild/amazonlinux-aarch64-standard:3.0",
      }),
      Source: Match.objectLike({
        BuildSpec: Match.stringLikeRegexp('"nodejs": 22[\\s\\S]*npm run lint'),
      }),
    });
  });

  it("verifies each stage with integration tests and web checks", () => {
    expect(verifyCommands()).toContain(
      'WEB_ORIGIN="$WEB_URL" npm run test:integration --prefix backend',
    );
    template.hasResourceProperties("AWS::CodeBuild::Project", {
      Source: Match.objectLike({
        BuildSpec: Match.stringLikeRegexp("test:integration[\\s\\S]*config.json"),
      }),
    });
    for (const [stage, scope] of [
      ["Test", "stage"],
      ["Prod", "readonly"],
    ]) {
      template.hasResourceProperties("AWS::CodeBuild::Project", {
        Environment: Match.objectLike({
          EnvironmentVariables: Match.arrayWith([
            Match.objectLike({ Name: "EXPECTED_STAGE", Value: stage }),
            Match.objectLike({ Name: "INTEGRATION_SCOPE", Value: scope }),
          ]),
        }),
      });
    }
    const pipelineJson = JSON.stringify(template.findResources("AWS::CodePipeline::Pipeline"));
    expect(pipelineJson).toContain("API_URL");
    expect(pipelineJson).toContain("WEB_URL");
  });

  it("runs daily at 10:00 UTC through EventBridge Scheduler", () => {
    template.hasResourceProperties("AWS::Scheduler::Schedule", {
      Name: "AllPlay-DailyPipelineRun",
      ScheduleExpression: "cron(0 10 * * ? *)",
    });
  });

  it("alerts on failures and on a $25 monthly budget", () => {
    template.hasResourceProperties("AWS::SNS::Topic", { TopicName: "AllPlay-Alerts" });
    template.hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "email",
      Endpoint: ALERT_EMAIL,
    });
    template.hasResource("AWS::CodeStarNotifications::NotificationRule", {
      Properties: Match.objectLike({
        EventTypeIds: ["codepipeline-pipeline-pipeline-execution-failed"],
      }),
      DependsOn: Match.arrayWith([Match.stringLikeRegexp("AlertsPolicy")]),
    });
    template.hasResourceProperties("AWS::Budgets::Budget", {
      Budget: Match.objectLike({ BudgetLimit: { Amount: 25, Unit: "USD" }, TimeUnit: "MONTHLY" }),
      NotificationsWithSubscribers: [
        Match.objectLike({
          Notification: Match.objectLike({ NotificationType: "ACTUAL", Threshold: 80 }),
        }),
        Match.objectLike({
          Notification: Match.objectLike({ NotificationType: "ACTUAL", Threshold: 100 }),
        }),
        Match.objectLike({
          Notification: Match.objectLike({ NotificationType: "FORECASTED", Threshold: 100 }),
        }),
      ],
    });
    template.hasResourceProperties("AWS::SNS::TopicPolicy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Principal: { Service: "budgets.amazonaws.com" } }),
        ]),
      },
    });
  });

  it("acknowledges only wildcard findings on the generated pipeline resources", () => {
    expect(pipeline.acknowledgedWildcards.length).toBeGreaterThan(0);
    for (const id of pipeline.acknowledgedWildcards) {
      expect(id).toMatch(
        /^AwsSolutions-IAM5\[(Action::s3:\w+\*|Resource::(\*|<PipelineArtifactsBucket\w+\.Arn>\/\*|arn:aws:logs:.*|arn:aws:codebuild:.*report-group\/.*|arn:\*:iam::<AWS::AccountId>:role\/\*))\]$/,
      );
    }
  });
});

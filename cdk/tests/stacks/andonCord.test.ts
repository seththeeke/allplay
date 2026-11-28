import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { buildApp } from "../../lib/app";
import { ALERT_EMAIL, ANDON_SERVICES } from "../../lib/stacks/AllPlayPipelineStack";
import { AllPlayStage } from "../../lib/stage";
import { WEB_FIXTURE, testApp } from "../testApp";

describe("andon cord", () => {
  const { pipeline } = buildApp(testApp());
  const account = Template.fromStack(pipeline);

  it("budgets each monitored service at $20 a month, notifying the andon topic and the alert email", () => {
    for (const [suffix, service] of ANDON_SERVICES) {
      account.hasResourceProperties("AWS::Budgets::Budget", {
        Budget: Match.objectLike({
          BudgetName: `AllPlay-${suffix}`,
          BudgetLimit: { Amount: 20, Unit: "USD" },
          TimeUnit: "MONTHLY",
          CostFilters: { Service: [service] },
        }),
        NotificationsWithSubscribers: [100, 150, 200].map((threshold) =>
          Match.objectLike({
            Notification: Match.objectLike({ NotificationType: "ACTUAL", Threshold: threshold }),
            Subscribers: [
              { SubscriptionType: "SNS", Address: { Ref: Match.stringLikeRegexp("^Andon") } },
              { SubscriptionType: "EMAIL", Address: ALERT_EMAIL },
            ],
          }),
        ),
      });
    }
  });

  it("lets only AWS Budgets publish to the andon topic, which AllPlay-AndonCord receives", () => {
    account.hasResourceProperties("AWS::SNS::Topic", { TopicName: "AllPlay-Andon" });
    account.hasResourceProperties("AWS::SNS::TopicPolicy", {
      Topics: [{ Ref: Match.stringLikeRegexp("^Andon") }],
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: "sns:Publish",
            Principal: { Service: "budgets.amazonaws.com" },
          }),
        ]),
      },
    });
    account.hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "lambda",
      TopicArn: { Ref: Match.stringLikeRegexp("^Andon") },
    });
    const functions = account.findResources("AWS::Lambda::Function", {
      Properties: { FunctionName: "AllPlay-AndonCord" },
    });
    const [cord] = Object.values(functions) as {
      Properties: {
        MemorySize: number;
        Timeout: number;
        Environment: { Variables: Record<string, string> };
      };
    }[];
    expect(cord?.Properties.MemorySize).toBe(256);
    expect(cord?.Properties.Timeout).toBe(30);
    expect(cord?.Properties.Environment.Variables["STAGE"]).toBeUndefined();
    expect(JSON.parse(cord?.Properties.Environment.Variables["ANDON_TARGETS"] ?? "[]")).toEqual([
      { stage: "Test", table: "AllPlay-SystemFlags-Test" },
      { stage: "Prod", table: "AllPlay-SystemFlags-Prod" },
    ]);
  });

  it("lets the cord write both flag tables and the deny policy on all eight Identity Pool roles", () => {
    const policies = Object.values(account.findResources("AWS::IAM::Policy")).map((policy) =>
      JSON.stringify(policy),
    );
    const cordPolicy = policies.find((policy) => policy.includes("AllPlay-SystemFlags-Test"));
    expect(cordPolicy).toBeDefined();
    expect(cordPolicy).toContain("AllPlay-SystemFlags-Prod");
    expect(cordPolicy).toContain("dynamodb:UpdateItem");
    expect(cordPolicy).toContain("iam:PutRolePolicy");
    for (const stage of ["Test", "Prod"])
      for (const role of ["GuestRole", "PlayerRole", "PlayerPlusRole", "AdminRole"])
        expect(cordPolicy).toContain(`role/AllPlay-${role}-${stage}`);
  });
});

describe("andon flag in a stage", () => {
  const stage = new AllPlayStage(testApp(), "Prod", {
    stageName: "Prod",
    webAssetPath: WEB_FIXTURE,
    env: { region: "us-east-1" },
  });
  const stateful = Template.fromStack(stage.stateful);
  const app = Template.fromStack(stage.app);

  it("keeps the flags in AllPlay-SystemFlags-<Stage>, keyed by flagId", () => {
    stateful.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      TableName: "AllPlay-SystemFlags-Prod",
      KeySchema: [{ AttributeName: "flagId", KeyType: "HASH" }],
    });
  });

  it("names the flag table to every API bundle but health", () => {
    for (const name of ["PlayerApi", "GameApi", "DecisionApi", "AdminApi"])
      app.hasResourceProperties("AWS::Lambda::Function", {
        FunctionName: `AllPlay-${name}-Prod`,
        Environment: {
          Variables: Match.objectLike({ SYSTEM_FLAGS_TABLE: Match.anyValue() }),
        },
      });
    const health = app.findResources("AWS::Lambda::Function", {
      Properties: { FunctionName: "AllPlay-HealthApi-Prod" },
    });
    expect(JSON.stringify(health)).not.toContain("SYSTEM_FLAGS_TABLE");
  });

  it("lets the admin Lambda change the flag and the stage's deny policies", () => {
    const admin = JSON.stringify(
      Object.entries(app.findResources("AWS::IAM::Policy")).filter(([id]) =>
        id.startsWith("AdminApi"),
      ),
    );
    expect(admin).toContain('"Action":["iam:DeleteRolePolicy","iam:PutRolePolicy"]');
    expect(admin).toContain('"Action":["dynamodb:GetItem","dynamodb:UpdateItem"]');
    expect(admin).toContain("SystemFlags");
  });
});

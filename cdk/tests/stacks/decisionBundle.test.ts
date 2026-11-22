import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { AllPlayStage } from "../../lib/stage";
import { WEB_FIXTURE, testApp } from "../testApp";

const synth = (stageName: "Test" | "Prod") =>
  Template.fromStack(
    new AllPlayStage(testApp(), stageName, {
      stageName,
      webAssetPath: WEB_FIXTURE,
      env: { region: "us-east-1" },
    }).app,
  );

describe("decision bundle", () => {
  const app = synth("Test");

  it("serves the decision routes from AllPlay-DecisionApi, keeping its turn log 30 days", () => {
    app.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "AllPlay-DecisionApi-Test",
      MemorySize: 1024,
      Timeout: 10,
      Environment: {
        Variables: Match.objectLike({
          GAME_SESSIONS_TABLE: Match.anyValue(),
          PREFERENCES_TABLE: Match.anyValue(),
          RATE_LIMITS_TABLE: Match.anyValue(),
          DECIDER_MODEL_ID: "us.amazon.nova-micro-v1:0",
          DECIDER_FIXED_RESPONSES: "ENABLED",
        }),
      },
    });
    app.hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: "/aws/lambda/AllPlay-DecisionApi-Test",
      RetentionInDays: 30,
    });
    for (const routeKey of ["POST /v1/decisions", "POST /v1/decisions/{decisionId}/resolution"])
      app.hasResourceProperties("AWS::ApiGatewayV2::Route", {
        RouteKey: routeKey,
        AuthorizationType: "AWS_IAM",
      });
    app.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      RouteSettings: {
        "POST /v1/decisions": { ThrottlingRateLimit: 50, ThrottlingBurstLimit: 100 },
      },
    });
  });

  it("answers fixed test commands in Test only", () => {
    const prod = JSON.stringify(
      synth("Prod").findResources("AWS::Lambda::Function", {
        Properties: { FunctionName: "AllPlay-DecisionApi-Prod" },
      }),
    );
    expect(prod).toContain("DECIDER_MODEL_ID");
    expect(prod).not.toContain("DECIDER_FIXED_RESPONSES");
  });

  it("grants the model's profile and its foundation model in each routed region, no wildcard", () => {
    const statements = Object.entries(app.findResources("AWS::IAM::Policy"))
      .filter(([logicalId]) => logicalId.startsWith("DecisionApi"))
      .flatMap(
        ([, value]) =>
          (value as { Properties: { PolicyDocument: { Statement: unknown[] } } }).Properties
            .PolicyDocument.Statement,
      )
      .map((statement) => JSON.stringify(statement));
    const bedrock = statements.find((statement) => statement.includes("bedrock:InvokeModel")) ?? "";
    expect(bedrock).toContain(":inference-profile/us.amazon.nova-micro-v1:0");
    for (const region of ["us-east-1", "us-east-2", "us-west-2"])
      expect(bedrock).toContain(`:bedrock:${region}::foundation-model/amazon.nova-micro-v1:0`);
    expect(bedrock).not.toContain("*");
    const all = statements.join();
    expect(all).toContain("RateLimits");
    for (const action of ["DeleteItem", "Scan"]) expect(all).not.toContain(action);
  });

  it("raises the stage's alarms on the alert topic", () => {
    for (const name of [
      "AllPlay-DecisionApiErrors-Test",
      "AllPlay-GameApiErrors-Test",
      "AllPlay-Api5xx-Test",
      "AllPlay-BedrockThrottled-Test",
    ])
      app.hasResourceProperties("AWS::CloudWatch::Alarm", {
        AlarmName: name,
        ComparisonOperator: "GreaterThanOrEqualToThreshold",
        EvaluationPeriods: 1,
        TreatMissingData: "notBreaching",
        AlarmActions: [Match.objectLike({ "Fn::Join": Match.anyValue() })],
      });
    app.hasResourceProperties("AWS::Logs::MetricFilter", {
      FilterPattern: '"BEDROCK_THROTTLED"',
      MetricTransformations: [
        Match.objectLike({ MetricNamespace: "AllPlay", MetricName: "BedrockThrottledTest" }),
      ],
    });
    expect(JSON.stringify(app.findResources("AWS::CloudWatch::Alarm"))).toContain(
      ":AllPlay-Alerts",
    );
  });
});

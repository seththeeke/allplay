import { Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Code, Function as LambdaFunction, Runtime } from "aws-cdk-lib/aws-lambda";
import { describe, expect, it } from "vitest";
import { AllPlayApi } from "../../lib/constructs/AllPlayApi";
import { AllPlayStage } from "../../lib/stage";
import { WEB_FIXTURE, testApp } from "../testApp";

describe("player bundle", () => {
  const stage = new AllPlayStage(testApp(), "Test", {
    stageName: "Test",
    webAssetPath: WEB_FIXTURE,
    env: { region: "us-east-1" },
  });
  const app = Template.fromStack(stage.app);

  it("serves the player routes from AllPlay-PlayerApi behind AWS_IAM", () => {
    app.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "AllPlay-PlayerApi-Test",
      MemorySize: 512,
      Timeout: 10,
      Environment: {
        Variables: Match.objectLike({
          PLAYERS_TABLE: Match.anyValue(),
          PREFERENCES_TABLE: Match.anyValue(),
          IDENTITY_POOL_ID: Match.anyValue(),
          USER_POOL_ID: Match.anyValue(),
        }),
      },
    });
    for (const routeKey of [
      "GET /v1/players/me",
      "GET /v1/players/me/preferences",
      "PATCH /v1/players/me/preferences/{scope}",
      "DELETE /v1/players/me",
    ]) {
      app.hasResourceProperties("AWS::ApiGatewayV2::Route", {
        RouteKey: routeKey,
        AuthorizationType: "AWS_IAM",
      });
    }
  });

  it("grants the player Lambda only the table calls it makes", () => {
    const policies = JSON.stringify(app.findResources("AWS::IAM::Policy"));
    expect(policies).toContain('"dynamodb:GetItem","dynamodb:PutItem","dynamodb:UpdateItem"');
    /* CDK sorts each statement's actions, so these are listed alphabetically. */
    expect(policies).toContain('"dynamodb:DeleteItem","dynamodb:Query","dynamodb:UpdateItem"');
    expect(policies).toContain('"cognito-idp:AdminDeleteUser","cognito-idp:ListUsers"');
    expect(policies).not.toContain("dynamodb:Scan");
  });

  it("refuses a public route in an IAM bundle", () => {
    const stack = new Stack(testApp(), "Refuse");
    const api = new AllPlayApi(stack, "Api", { stage: "Test", allowedOrigins: ["https://x"] });
    const fn = new LambdaFunction(stack, "Fn", {
      runtime: Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: Code.fromInline("exports.handler = async () => ({})"),
    });
    expect(() =>
      api.addBundle("Bad", [{ method: "GET", path: "/v1/x", auth: "NONE" }], fn),
    ).toThrow("not an IAM route");
  });
});

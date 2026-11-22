import { Duration, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { AwsSolutionsChecks } from "cdk-nag";
import { describe, expect, it } from "vitest";
import { AllPlayApi } from "../../lib/constructs/AllPlayApi";
import { AllPlayFunction } from "../../lib/constructs/AllPlayFunction";
import { testApp } from "../testApp";

function synth() {
  const app = testApp();
  const stack = new Stack(app, "ApiStack", { env: { region: "us-east-1" } });
  const api = new AllPlayApi(stack, "Api", {
    stage: "Test",
    allowedOrigins: ["https://example.cloudfront.net"],
  });
  const fn = new AllPlayFunction(stack, "HealthApi", {
    stage: "Test",
    name: "HealthApi",
    entry: "controller/web-api/health/handler.ts",
    memorySize: 256,
    timeout: Duration.seconds(5),
  });
  api.addPublicRoute(
    "HealthRoute",
    { method: "GET", path: "/v1/health", auth: "NONE" },
    fn.function,
  );
  return { stack, api, template: Template.fromStack(stack) };
}

describe("AllPlayApi", () => {
  it("creates a stage-named HTTP API with CORS for the web origins", () => {
    const { template } = synth();
    template.hasResourceProperties("AWS::ApiGatewayV2::Api", {
      Name: "AllPlay-Api-Test",
      ProtocolType: "HTTP",
      CorsConfiguration: Match.objectLike({
        AllowOrigins: ["https://example.cloudfront.net"],
        AllowMethods: ["GET", "POST", "PATCH", "DELETE"],
        AllowHeaders: Match.arrayWith([
          "authorization",
          "x-amz-security-token",
          "x-amz-user-agent",
        ]),
        MaxAge: 3600,
      }),
    });
  });

  it("deploys a throttled default stage with JSON access logs", () => {
    const { template } = synth();
    template.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      StageName: "$default",
      AutoDeploy: true,
      DefaultRouteSettings: { ThrottlingBurstLimit: 40, ThrottlingRateLimit: 20 },
      AccessLogSettings: Match.objectLike({ Format: Match.stringLikeRegexp('"requestId"') }),
    });
    template.hasResourceProperties("AWS::Logs::LogGroup", { RetentionInDays: 14 });
  });

  it("adds a public route without an authorizer", () => {
    const { template, api, stack } = synth();
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "GET /v1/health",
      AuthorizationType: "NONE",
    });
    expect(stack.resolve(api.url)).toBeDefined();
  });

  it("passes cdk-nag with the public route acknowledged", () => {
    const { stack } = synth();
    expect(new AwsSolutionsChecks().validateScope(stack).violations).toEqual([]);
  });
});

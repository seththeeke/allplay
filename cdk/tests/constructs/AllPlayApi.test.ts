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

  it("throttles a bundle route on the stage only after the route exists", () => {
    const stack = new Stack(testApp(), "Throttled", { env: { region: "us-east-1" } });
    const api = new AllPlayApi(stack, "Api", { stage: "Test", allowedOrigins: ["https://x"] });
    const fn = new AllPlayFunction(stack, "DecisionApi", {
      stage: "Test",
      name: "DecisionApi",
      entry: "controller/web-api/health/handler.ts",
      memorySize: 256,
      timeout: Duration.seconds(5),
    });
    expect(() => {
      api.throttleRoutes({ "POST /v1/decisions": { rateLimit: 50, burstLimit: 100 } });
    }).toThrow("Add POST /v1/decisions before throttling it.");
    api.addBundle(
      "Decisions",
      [{ method: "POST", path: "/v1/decisions", auth: "IAM" }],
      fn.function,
    );
    api.throttleRoutes({ "POST /v1/decisions": { rateLimit: 50, burstLimit: 100 } });
    const template = Template.fromStack(stack);
    const [routeId] = Object.keys(
      template.findResources("AWS::ApiGatewayV2::Route", {
        Properties: { RouteKey: "POST /v1/decisions" },
      }),
    );
    const [stage] = Object.values(template.findResources("AWS::ApiGatewayV2::Stage")) as {
      DependsOn?: string[];
      Properties: { RouteSettings: unknown };
    }[];
    expect(stage?.DependsOn).toContain(routeId);
    expect(stage?.Properties.RouteSettings).toEqual({
      "POST /v1/decisions": { ThrottlingRateLimit: 50, ThrottlingBurstLimit: 100 },
    });
  });
});

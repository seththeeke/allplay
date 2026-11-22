import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { AllPlayStage } from "../../lib/stage";
import { WEB_FIXTURE, testApp } from "../testApp";

function synth() {
  const stage = new AllPlayStage(testApp(), "Test", {
    stageName: "Test",
    webAssetPath: WEB_FIXTURE,
    env: { region: "us-east-1" },
  });
  return { stage, template: Template.fromStack(stage.app) };
}

describe("AllPlayAppStack", () => {
  it("serves the health route from the dedicated HealthApi Lambda", () => {
    const { template } = synth();
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "AllPlay-HealthApi-Test",
      MemorySize: 256,
      Timeout: 5,
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "GET /v1/health",
      AuthorizationType: "NONE",
    });
  });

  it("allows the stage's CloudFront origin through CORS", () => {
    const { template } = synth();
    const api = Object.values(template.findResources("AWS::ApiGatewayV2::Api"))[0];
    expect(JSON.stringify(api)).toContain("WebDistribution");
  });

  it("writes config.json with the stage, memory mode and the API URL", () => {
    const { template, stage } = synth();
    expect(stage.app.resolve(stage.app.webConfig)).toMatchObject({
      stage: "TEST",
      dataMode: "LIVE",
      region: "us-east-1",
    });
    const deployments = JSON.stringify(template.findResources("Custom::CDKBucketDeployment"));
    expect(deployments).toMatch(
      /"SourceMarkers":\[\{\},\{"<<marker:0xbaba:0>>":\{"Ref":"Api\w+"\}/,
    );
  });

  it("outputs the API and web URLs for the pipeline's checks", () => {
    const { template, stage } = synth();
    template.hasOutput("ApiUrl", {});
    template.hasOutput("WebUrl", {});
    expect(stage.app.apiUrl.node.id).toBe("ApiUrl");
    expect(stage.app.webUrl.node.id).toBe("WebUrl");
  });
});

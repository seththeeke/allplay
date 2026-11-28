import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { AllPlayStage } from "../../lib/stage";
import { WEB_FIXTURE, testApp } from "../testApp";

describe("admin bundle", () => {
  const stage = new AllPlayStage(testApp(), "Test", {
    stageName: "Test",
    webAssetPath: WEB_FIXTURE,
    env: { region: "us-east-1" },
  });
  const app = Template.fromStack(stage.app);

  it("serves the deployment routes from AllPlay-AdminApi behind AWS_IAM", () => {
    app.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "AllPlay-AdminApi-Test",
      MemorySize: 512,
      Timeout: 10,
      Environment: { Variables: Match.objectLike({ IDENTITY_POOL_ID: Match.anyValue() }) },
    });
    for (const routeKey of [
      "GET /v1/admin/deployments",
      "POST /v1/admin/deployments",
      "GET /v1/admin/players/duplicates",
      "POST /v1/admin/players/merge",
      "GET /v1/admin/andon",
      "PUT /v1/admin/andon",
      "POST /v1/admin/invitations",
    ])
      app.hasResourceProperties("AWS::ApiGatewayV2::Route", {
        RouteKey: routeKey,
        AuthorizationType: "AWS_IAM",
      });
  });

  it("gives only the admin Lambda the pipeline calls, on the All Play pipeline", () => {
    const policies = Object.entries(app.findResources("AWS::IAM::Policy")).filter(([, policy]) =>
      JSON.stringify(policy).includes("codepipeline:"),
    );
    expect(policies).toHaveLength(1);
    const [[logicalId, policy]] = policies as [[string, unknown]];
    expect(logicalId).toContain("AdminApi");
    const text = JSON.stringify(policy);
    expect(text).toContain(
      '"codepipeline:ListActionExecutions","codepipeline:ListPipelineExecutions","codepipeline:StartPipelineExecution"',
    );
    expect(text).toContain('{"Ref":"AWS::AccountId"},":AllPlay"');
  });

  it("lets only the admin role invoke admin routes", () => {
    const roles = app.findResources("AWS::IAM::Role");
    const invokers = Object.entries(app.findResources("AWS::IAM::Policy"))
      .filter(([, policy]) => JSON.stringify(policy).includes("/v1/admin/deployments"))
      .map(([, policy]) =>
        JSON.stringify((policy as { Properties: { Roles: unknown } }).Properties.Roles),
      );
    expect(invokers).toHaveLength(1);
    const adminRoleId = Object.entries(roles).find(([, role]) =>
      JSON.stringify(role).includes("AllPlay-AdminRole-Test"),
    )?.[0];
    expect(invokers[0]).toContain(String(adminRoleId));
  });

  it("lets the admin Lambda scan and query only ByEmail, and merge accounts", () => {
    const [policy] = Object.entries(app.findResources("AWS::IAM::Policy"))
      .filter(([logicalId]) => logicalId.startsWith("AdminApi"))
      .map(([, value]) => JSON.stringify(value));
    /* The duplicate list scans ByEmail; the game limits panel queries it (productionalization.md section 5). */
    expect(policy).toContain('"Action":["dynamodb:Query","dynamodb:Scan"]');
    expect(policy).toContain('/index/ByEmail"');
    expect(policy).toContain(
      '"cognito-idp:AdminDeleteUser","cognito-idp:AdminGetUser","cognito-idp:AdminLinkProviderForUser","cognito-idp:ListUsers"',
    );
    app.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "AllPlay-AdminApi-Test",
      Environment: {
        Variables: Match.objectLike({
          PLAYERS_TABLE: Match.anyValue(),
          PREFERENCES_TABLE: Match.anyValue(),
          MERGE_TOKENS_TABLE: Match.anyValue(),
          USER_POOL_ID: Match.anyValue(),
        }),
      },
    });
  });

  it("reads the rollups and queries only the turn log for metrics and failures", () => {
    for (const routeKey of ["GET /v1/admin/metrics", "GET /v1/admin/decisions"])
      app.hasResourceProperties("AWS::ApiGatewayV2::Route", {
        RouteKey: routeKey,
        AuthorizationType: "AWS_IAM",
      });
    app.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "AllPlay-AdminApi-Test",
      Environment: {
        Variables: Match.objectLike({
          METRIC_ROLLUPS_TABLE: Match.anyValue(),
          TURN_LOG_GROUP: Match.anyValue(),
        }),
      },
    });
    const statements = Object.entries(app.findResources("AWS::IAM::Policy"))
      .filter(([logicalId]) => logicalId.startsWith("AdminApi"))
      .flatMap(
        ([, value]) =>
          (value as { Properties: { PolicyDocument: { Statement: unknown[] } } }).Properties
            .PolicyDocument.Statement,
      )
      .map((statement) => JSON.stringify(statement));
    const start = statements.find((statement) => statement.includes("logs:StartQuery")) ?? "";
    expect(start).toContain("DecisionApiLogs");
    expect(statements.find((statement) => statement.includes("logs:GetQueryResults"))).toContain(
      '"Resource":"*"',
    );
    expect(statements.find((statement) => statement.includes("MetricRollups"))).toContain(
      '"Action":"dynamodb:Query"',
    );
  });

  it("lets the admin Lambda invite players into its stage's pool", () => {
    const admin = JSON.stringify(
      Object.entries(app.findResources("AWS::IAM::Policy")).filter(([id]) =>
        id.startsWith("AdminApi"),
      ),
    );
    expect(admin).toContain("cognito-idp:AdminCreateUser");
    expect(admin).toContain("cognito-idp:AdminAddUserToGroup");
  });
});

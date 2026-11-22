import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { gameRoutes } from "../../../backend/src/controller/web-api/game/gameRoutes";
import { AllPlayStage } from "../../lib/stage";
import { WEB_FIXTURE, testApp } from "../testApp";

describe("game bundle", () => {
  const stage = new AllPlayStage(testApp(), "Test", {
    stageName: "Test",
    webAssetPath: WEB_FIXTURE,
    env: { region: "us-east-1" },
  });
  const app = Template.fromStack(stage.app);

  it("serves the catalog and session routes from AllPlay-GameApi behind AWS_IAM", () => {
    app.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "AllPlay-GameApi-Test",
      MemorySize: 1024,
      Timeout: 10,
      Environment: {
        Variables: Match.objectLike({
          GAME_SESSIONS_TABLE: Match.anyValue(),
          SEAT_ASSIGNMENTS_TABLE: Match.anyValue(),
          PLAYER_STATS_TABLE: Match.anyValue(),
        }),
      },
    });
    for (const route of gameRoutes)
      app.hasResourceProperties("AWS::ApiGatewayV2::Route", {
        RouteKey: `${route.method} ${route.path}`,
        AuthorizationType: "AWS_IAM",
      });
  });

  it("grants the game Lambda only the item calls of play, and no deletes or scans", () => {
    const statements = Object.entries(app.findResources("AWS::IAM::Policy"))
      .filter(([logicalId]) => logicalId.startsWith("GameApi"))
      .flatMap(
        ([, value]) =>
          (value as { Properties: { PolicyDocument: { Statement: unknown[] } } }).Properties
            .PolicyDocument.Statement,
      )
      .map((statement) => JSON.stringify(statement));
    /* Three table statements, plus the log grant every AllPlayFunction carries. */
    expect(statements).toHaveLength(4);
    const on = (text: string) => statements.find((statement) => statement.includes(text));
    expect(on("GameSessions")).toContain('"Action":["dynamodb:GetItem","dynamodb:PutItem"]');
    expect(on("GameSessions")).toContain("PlayerStats");
    expect(on('"dynamodb:Query"')).toContain("/index/ByPlayerGame");
    expect(on('"Action":"dynamodb:PutItem"')).toContain("SeatAssignments");
    const all = statements.join();
    for (const action of ["DeleteItem", "Scan", "UpdateItem"]) expect(all).not.toContain(action);
  });
});

import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { AllPlayStage } from "../../lib/stage";
import { WEB_FIXTURE, testApp } from "../testApp";

function synth(stageName: "Test" | "Prod" = "Test") {
  const stage = new AllPlayStage(testApp(), stageName, {
    stageName,
    webAssetPath: WEB_FIXTURE,
    env: { region: "us-east-1" },
  });
  return { stage, app: Template.fromStack(stage.app) };
}

describe("Identity Pool", () => {
  it("allows guests in Prod only, disables the classic flow, trusts both clients, and is retained", () => {
    synth("Prod").app.hasResourceProperties("AWS::Cognito::IdentityPool", {
      IdentityPoolName: "AllPlay_Identities_Prod",
      AllowUnauthenticatedIdentities: true,
    });
    const { app } = synth();
    app.hasResourceProperties("AWS::Cognito::IdentityPool", {
      IdentityPoolName: "AllPlay_Identities_Test",
      AllowUnauthenticatedIdentities: false,
      AllowClassicFlow: false,
      CognitoIdentityProviders: [
        Match.objectLike({ ServerSideTokenCheck: true }),
        Match.objectLike({ ServerSideTokenCheck: true }),
      ],
    });
    app.hasResource("AWS::Cognito::IdentityPool", { DeletionPolicy: "Retain" });
  });

  it("makes four roles that only this pool's identities of the right kind can assume", () => {
    const { app } = synth();
    for (const [name, amr] of [
      ["AllPlay-GuestRole-Test", "unauthenticated"],
      ["AllPlay-PlayerRole-Test", "authenticated"],
      ["AllPlay-PlayerPlusRole-Test", "authenticated"],
      ["AllPlay-AdminRole-Test", "authenticated"],
    ]) {
      app.hasResourceProperties("AWS::IAM::Role", {
        RoleName: name,
        AssumeRolePolicyDocument: Match.objectLike({
          Statement: [
            Match.objectLike({
              Action: "sts:AssumeRoleWithWebIdentity",
              Principal: { Federated: "cognito-identity.amazonaws.com" },
              Condition: {
                StringEquals: { "cognito-identity.amazonaws.com:aud": Match.anyValue() },
                "ForAnyValue:StringLike": { "cognito-identity.amazonaws.com:amr": amr },
              },
            }),
          ],
        }),
      });
    }
  });

  it("lets each role invoke its tier's IAM routes, never the public health route, plus Transcribe and Polly", () => {
    const { app } = synth();
    const policies = JSON.stringify(app.findResources("AWS::IAM::Policy"));
    expect(policies).toContain("/$default/POST/v1/decisions");
    expect(policies).toContain("/$default/GET/v1/sessions/*/hint");
    expect(policies).not.toContain("/v1/health");
    /* Deleting an account needs a signed-in tier, so only the account roles may call it. */
    const guestPolicy = JSON.stringify(
      Object.values(app.findResources("AWS::IAM::Policy")).find((policy) =>
        JSON.stringify(policy).includes("GuestRole"),
      ),
    );
    expect(guestPolicy).toContain("/$default/GET/v1/players/me");
    expect(guestPolicy).not.toContain("/$default/DELETE/v1/players/me");
    expect(policies).toContain("/$default/DELETE/v1/players/me");
    expect(policies).toContain("transcribe:StartStreamTranscriptionWebSocket");
    expect(policies).toContain("polly:SynthesizeSpeech");
  });

  it("maps signed-in players by group, with ambiguous tokens on the player role", () => {
    const { app } = synth();
    const attachment = JSON.stringify(
      app.findResources("AWS::Cognito::IdentityPoolRoleAttachment"),
    );
    expect(attachment).toContain('"Type":"Rules"');
    expect(attachment).toContain('"AmbiguousRoleResolution":"AuthenticatedRole"');
    expect(attachment).toContain('"Value":"ADMIN"');
    expect(attachment).toContain('"Value":"PLAYER_PLUS"');
    expect(attachment.match(/"IdentityProvider"/g)).toHaveLength(2);
  });

  it("publishes the pool id in config.json and as an output", () => {
    const { stage, app } = synth();
    expect(Object.keys(stage.app.resolve(stage.app.webConfig) as object)).toContain(
      "identityPoolId",
    );
    expect(Object.keys(app.findOutputs("*"))).toContain("IdentityPoolId");
  });
});

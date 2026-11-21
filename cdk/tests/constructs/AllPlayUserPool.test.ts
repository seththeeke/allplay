import { Template, Match } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { AllPlayStage } from "../../lib/stage";
import { WEB_FIXTURE, testApp } from "../testApp";

function synth(stageName: "Test" | "Prod") {
  const stage = new AllPlayStage(testApp(), stageName, {
    stageName,
    webAssetPath: WEB_FIXTURE,
    env: { region: "us-east-1" },
  });
  return {
    stage,
    stateful: Template.fromStack(stage.stateful),
    app: Template.fromStack(stage.app),
  };
}

describe("User Pool", () => {
  it("signs in by email with the spec's password policy, emailed codes and email-only recovery", () => {
    const { stateful } = synth("Test");
    stateful.hasResourceProperties("AWS::Cognito::UserPool", {
      UserPoolName: "AllPlay-Users-Test",
      UserPoolTier: "ESSENTIALS",
      UsernameAttributes: ["email"],
      AutoVerifiedAttributes: ["email"],
      UsernameConfiguration: { CaseSensitive: false },
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: false },
      Policies: {
        PasswordPolicy: Match.objectLike({
          MinimumLength: 8,
          RequireLowercase: true,
          RequireUppercase: true,
          RequireNumbers: true,
          RequireSymbols: false,
        }),
      },
      AccountRecoverySetting: { RecoveryMechanisms: [{ Name: "verified_email", Priority: 1 }] },
      DeletionProtection: "INACTIVE",
      LambdaConfig: { CustomMessage: Match.anyValue() },
    });
    stateful.hasResource("AWS::Cognito::UserPool", { DeletionPolicy: "Retain" });
    stateful.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "AllPlay-CognitoCustomMessage-Test",
    });
    expect(
      synth("Prod").stateful.findResources("AWS::Cognito::UserPool", {
        Properties: { DeletionProtection: "ACTIVE" },
      }),
    ).not.toEqual({});
  });

  it("has the three groups by precedence and a managed login domain with the random suffix", () => {
    const { stateful } = synth("Test");
    for (const [GroupName, Precedence] of [
      ["ADMIN", 1],
      ["PLAYER_PLUS", 5],
      ["PLAYER", 10],
    ] as const) {
      stateful.hasResourceProperties("AWS::Cognito::UserPoolGroup", { GroupName, Precedence });
    }
    stateful.hasResourceProperties("AWS::Cognito::UserPoolDomain", {
      Domain: "allplay-test-jbus19",
      ManagedLoginVersion: 1,
    });
  });

  it("adds public web and iOS clients, with localhost allowed only in Test", () => {
    const { app } = synth("Test");
    app.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      ClientName: "AllPlay-Web-Test",
      GenerateSecret: false,
      ExplicitAuthFlows: Match.arrayWith(["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]),
      AllowedOAuthFlows: ["code"],
      AllowedOAuthScopes: ["openid", "email", "profile"],
      CallbackURLs: Match.arrayWith(["http://localhost:5173/"]),
      PreventUserExistenceErrors: "ENABLED",
      IdTokenValidity: 60,
      AccessTokenValidity: 60,
      RefreshTokenValidity: 129600,
      SupportedIdentityProviders: ["COGNITO"],
    });
    app.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      ClientName: "AllPlay-iOS-Test",
      CallbackURLs: ["allplay://auth/"],
    });
    const prodWeb = Object.values(
      synth("Prod").app.findResources("AWS::Cognito::UserPoolClient", {
        Properties: { ClientName: "AllPlay-Web-Prod" },
      }),
    );
    expect(JSON.stringify(prodWeb)).not.toContain("localhost");
  });

  it("publishes the pool, web client and login domain in config.json", () => {
    const { stage } = synth("Test");
    const config = stage.app.resolve(stage.app.webConfig) as Record<string, unknown>;
    expect(Object.keys(config)).toEqual(
      expect.arrayContaining(["userPoolId", "userPoolClientId", "oauthDomain"]),
    );
  });

  it("requires the domain suffix in context", () => {
    expect(
      () =>
        new AllPlayStage(testApp({ "allplay:authDomainSuffix": undefined }), "Test", {
          stageName: "Test",
          webAssetPath: WEB_FIXTURE,
          env: { region: "us-east-1" },
        }),
    ).toThrow("authDomainSuffix");
  });
});

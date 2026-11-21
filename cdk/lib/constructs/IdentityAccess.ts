import { CfnOutput, RemovalPolicy, Stack, Validations } from "aws-cdk-lib";
import type { HttpApi } from "aws-cdk-lib/aws-apigatewayv2";
import type { IUserPool, IUserPoolClient } from "aws-cdk-lib/aws-cognito";
import { CfnIdentityPool, CfnIdentityPoolRoleAttachment } from "aws-cdk-lib/aws-cognito";
import { FederatedPrincipal, PolicyStatement, Role } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { resourceName, type StageName } from "../config";
import { acknowledgeGenerated } from "../nag";

export type Tier = "GUEST" | "PLAYER" | "PLAYER_PLUS" | "ADMIN";

/** A route from a backend route list file (cdk-stacks.md section 5). */
export interface ApiRoute {
  method: string;
  path: string;
  auth: string;
  minimumTier?: Tier;
}

export interface IdentityAccessProps {
  stage: StageName;
  userPool: IUserPool;
  clients: IUserPoolClient[];
  api: HttpApi;
  /** Every route of every bundle; each role may invoke the IAM routes at or below its tier. */
  routes: readonly ApiRoute[];
}

const ORDER: readonly Tier[] = ["GUEST", "PLAYER", "PLAYER_PLUS", "ADMIN"];

const ROLE_NAMES: Record<Tier, string> = {
  GUEST: "GuestRole",
  PLAYER: "PlayerRole",
  PLAYER_PLUS: "PlayerPlusRole",
  ADMIN: "AdminRole",
};

/**
 * The stage's Identity Pool and its four roles (authn-authz.md section 4).
 * Guests get unauthenticated identities; signed-in players are mapped by the
 * `cognito:groups` claim of their ID token: ADMIN to the admin role,
 * PLAYER_PLUS to the player plus role, anyone else to the player role. Each
 * role may invoke only the API routes at or below its tier, plus Transcribe
 * streaming and Polly. The pool is retained on deletion so guest identities,
 * and with them guest players, survive a stack replacement.
 */
export class IdentityAccess extends Construct {
  readonly identityPool: CfnIdentityPool;
  readonly roles: Record<Tier, Role>;
  readonly identityPoolIdOutput: CfnOutput;

  constructor(scope: Construct, id: string, props: IdentityAccessProps) {
    super(scope, id);
    const stack = Stack.of(this);
    this.identityPool = new CfnIdentityPool(this, "Pool", {
      identityPoolName: `AllPlay_Identities_${props.stage}`,
      allowUnauthenticatedIdentities: true,
      allowClassicFlow: false,
      cognitoIdentityProviders: props.clients.map((client) => ({
        providerName: props.userPool.userPoolProviderName,
        clientId: client.userPoolClientId,
        serverSideTokenCheck: true,
      })),
    });
    this.identityPool.applyRemovalPolicy(RemovalPolicy.RETAIN);
    Validations.of(this.identityPool).acknowledge({
      id: "AwsSolutions-COG7",
      reason:
        "Guests play without an account by design; unauthenticated identities give them scoped credentials for the guest routes, Transcribe and Polly (authn-authz.md section 2).",
    });

    const role = (tier: Tier): Role => {
      const created = new Role(this, ROLE_NAMES[tier], {
        roleName: resourceName(ROLE_NAMES[tier], props.stage),
        description: `All Play ${tier} callers (authn-authz.md section 4)`,
        assumedBy: new FederatedPrincipal(
          "cognito-identity.amazonaws.com",
          {
            StringEquals: { "cognito-identity.amazonaws.com:aud": this.identityPool.ref },
            "ForAnyValue:StringLike": {
              "cognito-identity.amazonaws.com:amr":
                tier === "GUEST" ? "unauthenticated" : "authenticated",
            },
          },
          "sts:AssumeRoleWithWebIdentity",
        ),
      });
      const routes = props.routes.filter(
        (route) =>
          route.auth === "IAM" &&
          ORDER.indexOf(route.minimumTier ?? "GUEST") <= ORDER.indexOf(tier),
      );
      if (routes.length > 0) {
        created.addToPolicy(
          new PolicyStatement({
            actions: ["execute-api:Invoke"],
            /* Path parameters such as {sessionId} become one-segment wildcards. */
            resources: routes.map((route) =>
              props.api.arnForExecuteApi(
                route.method,
                route.path.replace(/\{[^}]+\}/g, "*"),
                "$default",
              ),
            ),
          }),
        );
      }
      created.addToPolicy(
        new PolicyStatement({
          actions: ["transcribe:StartStreamTranscriptionWebSocket", "polly:SynthesizeSpeech"],
          resources: ["*"],
        }),
      );
      acknowledgeGenerated(
        created,
        "AwsSolutions-IAM5[",
        "Transcribe streaming and Polly SynthesizeSpeech have no resource-level permissions, and route path parameters are one-segment wildcards (authn-authz.md section 4).",
      );
      return created;
    };
    this.roles = {
      GUEST: role("GUEST"),
      PLAYER: role("PLAYER"),
      PLAYER_PLUS: role("PLAYER_PLUS"),
      ADMIN: role("ADMIN"),
    };

    const groupRules = [
      {
        claim: "cognito:groups",
        matchType: "Contains",
        value: "ADMIN",
        roleArn: this.roles.ADMIN.roleArn,
      },
      {
        claim: "cognito:groups",
        matchType: "Contains",
        value: "PLAYER_PLUS",
        roleArn: this.roles.PLAYER_PLUS.roleArn,
      },
    ];
    new CfnIdentityPoolRoleAttachment(this, "Roles", {
      identityPoolId: this.identityPool.ref,
      roles: {
        unauthenticated: this.roles.GUEST.roleArn,
        authenticated: this.roles.PLAYER.roleArn,
      },
      roleMappings: Object.fromEntries(
        props.clients.map((client, index) => [
          `client${String(index)}`,
          {
            type: "Rules",
            ambiguousRoleResolution: "AuthenticatedRole",
            identityProvider: `${props.userPool.userPoolProviderName}:${client.userPoolClientId}`,
            rulesConfiguration: { rules: groupRules },
          },
        ]),
      ),
    });
    this.identityPoolIdOutput = new CfnOutput(stack, "IdentityPoolId", {
      value: this.identityPool.ref,
    });
  }
}

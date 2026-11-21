import { Duration, RemovalPolicy, Validations } from "aws-cdk-lib";
import {
  AccountRecovery,
  CfnUserPoolGroup,
  FeaturePlan,
  ManagedLoginVersion,
  OAuthScope,
  UserPool,
  UserPoolClient,
  UserPoolClientIdentityProvider,
  VerificationEmailStyle,
  type UserPoolDomain,
} from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";
import { isProd, resourceName, type StageName } from "../config";
import { AllPlayFunction } from "./AllPlayFunction";

/** User Pool groups and their precedence (authn-authz.md section 3); lower wins. */
export const USER_GROUPS = [
  ["ADMIN", 1],
  ["PLAYER_PLUS", 5],
  ["PLAYER", 10],
] as const;

export interface AllPlayUserPoolProps {
  stage: StageName;
  /** Fixed random suffix of the managed login domain, from CDK context, so URLs never carry the account id. */
  domainSuffix: string;
}

export interface AppClientProps {
  /** Callback and sign-out URLs (authn-authz.md section 3). */
  urls: string[];
}

/**
 * The stage's Cognito User Pool (authn-authz.md section 3): email sign-in,
 * self sign-up with an emailed code, the password policy, email-only
 * recovery, the three groups, the managed login domain and the custom
 * message trigger. Retained on deletion, with deletion protection in Prod.
 * App clients are added by the app stack, which knows the web origin.
 */
export class AllPlayUserPool extends Construct {
  readonly userPool: UserPool;
  readonly domain: UserPoolDomain;
  readonly customMessage: AllPlayFunction;

  constructor(scope: Construct, id: string, props: AllPlayUserPoolProps) {
    super(scope, id);
    const prod = isProd(props.stage);
    this.customMessage = new AllPlayFunction(this, "CustomMessage", {
      stage: props.stage,
      name: "CognitoCustomMessage",
      entry: "controller/cognito/customMessageHandler.ts",
      memorySize: 256,
      timeout: Duration.seconds(5),
    });
    this.userPool = new UserPool(this, "UserPool", {
      userPoolName: resourceName("Users", props.stage),
      featurePlan: FeaturePlan.ESSENTIALS,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      selfSignUpEnabled: true,
      autoVerify: { email: true },
      userVerification: { emailStyle: VerificationEmailStyle.CODE },
      standardAttributes: { email: { required: true, mutable: true } },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      deletionProtection: prod,
      removalPolicy: RemovalPolicy.RETAIN,
      lambdaTriggers: { customMessage: this.customMessage.function },
    });
    for (const [groupName, precedence] of USER_GROUPS) {
      new CfnUserPoolGroup(this, `Group${groupName}`, {
        userPoolId: this.userPool.userPoolId,
        groupName,
        precedence,
      });
    }
    this.domain = this.userPool.addDomain("Domain", {
      cognitoDomain: {
        domainPrefix: `allplay-${props.stage.toLowerCase()}-${props.domainSuffix}`,
      },
      managedLoginVersion: ManagedLoginVersion.CLASSIC_HOSTED_UI,
    });
    for (const [id, reason] of [
      [
        "AwsSolutions-COG1",
        "The password policy omits required symbols on purpose: players may have motor impairments and long symbol-heavy passwords are hard to type (authn-authz.md section 3).",
      ],
      [
        "AwsSolutions-COG2",
        "MFA is off by design for accessibility; guests need no account and Google and Apple sign-in carry their own protections (authn-authz.md section 3).",
      ],
      [
        "AwsSolutions-COG8",
        "The Essentials feature plan is chosen for cost; the Plus plan's threat protection is not needed for a free game portal (authn-authz.md section 3).",
      ],
      [
        "AwsSolutions-COG3",
        "Threat protection needs the Plus feature plan; the Essentials plan is chosen for cost (authn-authz.md section 3).",
      ],
    ] as const) {
      Validations.of(this.userPool).acknowledge({ id, reason });
    }
  }

  /**
   * Adds a public app client (authn-authz.md section 3): no secret, SRP and
   * refresh token flows, authorization code grant with PKCE, scopes `openid
   * email profile`, ID and access tokens for one hour and refresh tokens for 90 days.
   */
  appClient(scope: Construct, id: string, name: string, props: AppClientProps): UserPoolClient {
    /* Created in the caller's scope (the app stack), which owns the web origin the URLs name. */
    return new UserPoolClient(scope, id, {
      userPool: this.userPool,
      userPoolClientName: name,
      generateSecret: false,
      authFlows: { userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [OAuthScope.OPENID, OAuthScope.EMAIL, OAuthScope.PROFILE],
        callbackUrls: props.urls,
        logoutUrls: props.urls,
      },
      supportedIdentityProviders: [UserPoolClientIdentityProvider.COGNITO],
      preventUserExistenceErrors: true,
      idTokenValidity: Duration.hours(1),
      accessTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(90),
    });
  }
}

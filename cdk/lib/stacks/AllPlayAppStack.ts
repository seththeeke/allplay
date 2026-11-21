import { CfnOutput, Duration, Stack, type StackProps } from "aws-cdk-lib";
import type { UserPoolClient } from "aws-cdk-lib/aws-cognito";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";
import { adminRoutes } from "../../../backend/src/controller/web-api/admin/adminRoutes";
import { decisionsRoutes } from "../../../backend/src/controller/web-api/decisions/decisionsRoutes";
import { gameRoutes } from "../../../backend/src/controller/web-api/game/gameRoutes";
import { healthRoutes } from "../../../backend/src/controller/web-api/health/healthRoutes";
import {
  appleNotificationsRoute,
  playersRoutes,
} from "../../../backend/src/controller/web-api/players/playersRoutes";
import { PROJECT_NAME, resourceName, type StageName } from "../config";
import { AllPlayApi } from "../constructs/AllPlayApi";
import { AllPlayFunction } from "../constructs/AllPlayFunction";
import { IdentityAccess } from "../constructs/IdentityAccess";
import { WebHosting } from "../constructs/WebHosting";
import type { AllPlayStatefulStack } from "./AllPlayStatefulStack";

export interface AllPlayAppStackProps extends StackProps {
  stage: StageName;
  stateful: AllPlayStatefulStack;
  /** Directory holding the web app's production build. */
  webAssetPath: string;
}

/**
 * The replaceable application: API, Lambdas, scheduled jobs and web hosting
 * (cdk-stacks.md section 2). It depends on the stateful stack, never the
 * reverse. The walking skeleton holds the web app and the health route.
 */
export class AllPlayAppStack extends Stack {
  readonly stage: StageName;
  readonly web: WebHosting;
  readonly api: AllPlayApi;
  readonly apiUrl: CfnOutput;
  readonly webUrl: CfnOutput;
  /** The stage's config.json content (cdk-stacks.md section 6). */
  readonly webConfig: Record<string, unknown>;
  readonly webClient: UserPoolClient;
  readonly iosClient: UserPoolClient;
  /** Guest and signed-in AWS credentials and the four roles (authn-authz.md section 4). */
  readonly identity: IdentityAccess;

  constructor(scope: Construct, id: string, props: AllPlayAppStackProps) {
    super(scope, id, props);
    this.stage = props.stage;
    this.addStackDependency(props.stateful);
    this.web = new WebHosting(this, "Web", { stage: props.stage, assetPath: props.webAssetPath });
    this.api = new AllPlayApi(this, "Api", {
      stage: props.stage,
      allowedOrigins: [this.web.origin],
    });
    const health = new AllPlayFunction(this, "HealthApi", {
      stage: props.stage,
      name: "HealthApi",
      entry: "controller/web-api/health/handler.ts",
      memorySize: 256,
      timeout: Duration.seconds(5),
    });
    const [healthRoute] = healthRoutes;
    this.api.addPublicRoute("HealthRoute", healthRoute, health.function);
    /* App clients live here because the web client's URLs name this stack's CloudFront origin. */
    const users = props.stateful.users;
    const webUrls = [
      `${this.web.origin}/`,
      ...(props.stage === "Test" ? ["http://localhost:5173/"] : []),
    ];
    this.webClient = users.appClient(this, "WebClient", resourceName("Web", props.stage), {
      urls: webUrls,
    });
    this.iosClient = users.appClient(this, "IosClient", resourceName("iOS", props.stage), {
      urls: ["allplay://auth/"],
    });
    this.identity = new IdentityAccess(this, "Identity", {
      stage: props.stage,
      userPool: users.userPool,
      clients: [this.webClient, this.iosClient],
      api: this.api.api,
      routes: [
        ...healthRoutes,
        ...gameRoutes,
        ...decisionsRoutes,
        ...playersRoutes,
        ...adminRoutes,
      ],
    });
    const { players, preferences } = props.stateful;
    const playerApi = new AllPlayFunction(this, "PlayerApi", {
      stage: props.stage,
      name: "PlayerApi",
      entry: "controller/web-api/players/handler.ts",
      memorySize: 512,
      timeout: Duration.seconds(10),
      environment: {
        PLAYERS_TABLE: players.table.tableName,
        PREFERENCES_TABLE: preferences.table.tableName,
        IDENTITY_POOL_ID: this.identity.identityPool.ref,
        USER_POOL_ID: users.userPool.userPoolId,
        FEDERATION_SECRET_ID: props.stateful.federation.secret.secretName,
      },
    });
    playerApi.function.addToRolePolicy(
      new PolicyStatement({
        actions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"],
        resources: [players.table.tableArn],
      }),
    );
    playerApi.function.addToRolePolicy(
      new PolicyStatement({
        actions: ["dynamodb:Query", "dynamodb:UpdateItem", "dynamodb:DeleteItem"],
        resources: [preferences.table.tableArn],
      }),
    );
    /* Account deletion finds the user by sub and deletes it (authn-authz.md section 8). */
    playerApi.function.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "cognito-idp:ListUsers",
          "cognito-idp:AdminDeleteUser",
          "cognito-idp:AdminUserGlobalSignOut",
          "cognito-idp:AdminGetUser",
        ],
        resources: [users.userPool.userPoolArn],
      }),
    );
    /* Apple token revocation and notifications read the Sign in with Apple key (authn-authz.md section 12). */
    playerApi.function.addToRolePolicy(
      new PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [props.stateful.federation.secret.secretArn],
      }),
    );
    this.api.addPublicRoute("AppleNotifications", appleNotificationsRoute, playerApi.function);
    this.api.addBundle("Players", playersRoutes, playerApi.function);
    const adminApi = new AllPlayFunction(this, "AdminApi", {
      stage: props.stage,
      name: "AdminApi",
      entry: "controller/web-api/admin/handler.ts",
      memorySize: 512,
      timeout: Duration.seconds(10),
      environment: { IDENTITY_POOL_ID: this.identity.identityPool.ref },
    });
    /* Only the admin Lambda may read and start the pipeline (authn-authz.md section 5). */
    adminApi.function.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "codepipeline:ListPipelineExecutions",
          "codepipeline:ListActionExecutions",
          "codepipeline:StartPipelineExecution",
        ],
        resources: [this.formatArn({ service: "codepipeline", resource: PROJECT_NAME })],
      }),
    );
    this.api.addBundle("Admin", adminRoutes, adminApi.function);
    this.webConfig = {
      stage: props.stage.toUpperCase(),
      dataMode: "MEMORY",
      region: this.region,
      apiUrl: this.api.url,
      userPoolId: users.userPool.userPoolId,
      userPoolClientId: this.webClient.userPoolClientId,
      oauthDomain: users.domain.baseUrl().replace("https://", ""),
      identityPoolId: this.identity.identityPool.ref,
    };
    this.web.publish(this.webConfig);
    this.apiUrl = new CfnOutput(this, "ApiUrl", { value: this.api.url });
    this.webUrl = new CfnOutput(this, "WebUrl", { value: this.web.origin });
  }
}

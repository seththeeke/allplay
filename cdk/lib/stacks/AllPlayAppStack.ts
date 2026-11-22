import { CfnOutput, Duration, Stack, type StackProps } from "aws-cdk-lib";
import type { UserPoolClient } from "aws-cdk-lib/aws-cognito";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Metric } from "aws-cdk-lib/aws-cloudwatch";
import type { IFunction } from "aws-cdk-lib/aws-lambda";
import { FilterPattern, MetricFilter, RetentionDays } from "aws-cdk-lib/aws-logs";
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
import { AllPlayAlarm } from "../constructs/AllPlayAlarm";
import { AllPlayApi } from "../constructs/AllPlayApi";
import { AllPlayFunction } from "../constructs/AllPlayFunction";
import { IdentityAccess } from "../constructs/IdentityAccess";
import { WebHosting } from "../constructs/WebHosting";
import type { AllPlayStatefulStack } from "./AllPlayStatefulStack";

/** The decider's model (action-decision.md section 8): a US cross-region inference profile. */
export const DECIDER_MODEL_ID = "us.amazon.nova-micro-v1:0";
/** The regions that profile routes to; Bedrock checks the grant in each. */
const DECIDER_MODEL_REGIONS = ["us-east-1", "us-east-2", "us-west-2"];

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
  readonly webClientId: CfnOutput;
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
    const { players, preferences, mergeTokens } = props.stateful;
    const { gameSessions, seatAssignments, playerStats } = props.stateful;
    const gameTables = {
      GAME_SESSIONS_TABLE: gameSessions.table.tableName,
      SEAT_ASSIGNMENTS_TABLE: seatAssignments.table.tableName,
      PLAYER_STATS_TABLE: playerStats.table.tableName,
    };
    /*
     * Merging and deleting a player's games (data-model.md sections 9 and
     * 13): sessions are rewritten, ended or deleted, seats listed, moved and
     * deleted, stats combined and deleted. Transactions need each item's own action.
     */
    const grantGameData = (fn: IFunction) => {
      fn.addToRolePolicy(
        new PolicyStatement({
          actions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"],
          resources: [gameSessions.table.tableArn],
        }),
      );
      fn.addToRolePolicy(
        new PolicyStatement({
          actions: ["dynamodb:Query", "dynamodb:PutItem", "dynamodb:DeleteItem"],
          resources: [
            seatAssignments.table.tableArn,
            `${seatAssignments.table.tableArn}/index/ByPlayerGame`,
          ],
        }),
      );
      fn.addToRolePolicy(
        new PolicyStatement({
          actions: [
            "dynamodb:GetItem",
            "dynamodb:Query",
            "dynamodb:PutItem",
            "dynamodb:DeleteItem",
          ],
          resources: [playerStats.table.tableArn],
        }),
      );
    };
    const playerApi = new AllPlayFunction(this, "PlayerApi", {
      stage: props.stage,
      name: "PlayerApi",
      entry: "controller/web-api/players/handler.ts",
      memorySize: 512,
      timeout: Duration.seconds(10),
      environment: {
        PLAYERS_TABLE: players.table.tableName,
        PREFERENCES_TABLE: preferences.table.tableName,
        MERGE_TOKENS_TABLE: mergeTokens.table.tableName,
        ...gameTables,
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
    /* Merge tokens are written once and redeemed with a conditional update (data-model.md section 9). */
    playerApi.function.addToRolePolicy(
      new PolicyStatement({
        actions: ["dynamodb:PutItem", "dynamodb:UpdateItem"],
        resources: [mergeTokens.table.tableArn],
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
          "cognito-idp:AdminLinkProviderForUser",
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
    grantGameData(playerApi.function);
    this.api.addPublicRoute("AppleNotifications", appleNotificationsRoute, playerApi.function);
    this.api.addBundle("Players", playersRoutes, playerApi.function);
    const adminApi = new AllPlayFunction(this, "AdminApi", {
      stage: props.stage,
      name: "AdminApi",
      entry: "controller/web-api/admin/handler.ts",
      memorySize: 512,
      timeout: Duration.seconds(10),
      environment: {
        IDENTITY_POOL_ID: this.identity.identityPool.ref,
        PLAYERS_TABLE: players.table.tableName,
        PREFERENCES_TABLE: preferences.table.tableName,
        MERGE_TOKENS_TABLE: mergeTokens.table.tableName,
        ...gameTables,
        USER_POOL_ID: users.userPool.userPoolId,
      },
    });
    grantGameData(adminApi.function);
    /* The duplicate list scans ByEmail; the merge updates players, copies preferences and merges Cognito users (authn-authz.md section 6.2). */
    adminApi.function.addToRolePolicy(
      new PolicyStatement({
        actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
        resources: [players.table.tableArn],
      }),
    );
    adminApi.function.addToRolePolicy(
      new PolicyStatement({
        actions: ["dynamodb:Scan"],
        resources: [`${players.table.tableArn}/index/ByEmail`],
      }),
    );
    adminApi.function.addToRolePolicy(
      new PolicyStatement({
        actions: ["dynamodb:Query", "dynamodb:UpdateItem"],
        resources: [preferences.table.tableArn],
      }),
    );
    adminApi.function.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "cognito-idp:ListUsers",
          "cognito-idp:AdminGetUser",
          "cognito-idp:AdminDeleteUser",
          "cognito-idp:AdminLinkProviderForUser",
        ],
        resources: [users.userPool.userPoolArn],
      }),
    );
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
    /*
     * The game bundle (cdk-stacks.md section 3): a move puts its session; a
     * start or an end also puts seats and folds stats; resume reads the
     * ByPlayerGame index (data-model.md sections 6 to 8).
     */
    const gameApi = new AllPlayFunction(this, "GameApi", {
      stage: props.stage,
      name: "GameApi",
      entry: "controller/web-api/game/handler.ts",
      memorySize: 1024,
      timeout: Duration.seconds(10),
      environment: gameTables,
    });
    gameApi.function.addToRolePolicy(
      new PolicyStatement({
        actions: ["dynamodb:GetItem", "dynamodb:PutItem"],
        resources: [gameSessions.table.tableArn, playerStats.table.tableArn],
      }),
    );
    gameApi.function.addToRolePolicy(
      new PolicyStatement({
        actions: ["dynamodb:PutItem"],
        resources: [seatAssignments.table.tableArn],
      }),
    );
    gameApi.function.addToRolePolicy(
      new PolicyStatement({
        actions: ["dynamodb:Query"],
        resources: [`${seatAssignments.table.tableArn}/index/ByPlayerGame`],
      }),
    );
    this.api.addBundle("Game", gameRoutes, gameApi.function);
    /*
     * The decision bundle (action-decision.md sections 4 and 9.1): it plays
     * through the session service, reads autoConfirm, counts rate limits and
     * calls Bedrock. Its logs are the turn log, kept 30 days. Test answers
     * "itest" commands with fixed responses for its integration tests (AD-7).
     */
    const decisionApi = new AllPlayFunction(this, "DecisionApi", {
      stage: props.stage,
      name: "DecisionApi",
      entry: "controller/web-api/decisions/handler.ts",
      memorySize: 1024,
      timeout: Duration.seconds(10),
      logRetention: RetentionDays.ONE_MONTH,
      environment: {
        ...gameTables,
        PREFERENCES_TABLE: preferences.table.tableName,
        RATE_LIMITS_TABLE: props.stateful.rateLimits.table.tableName,
        DECIDER_MODEL_ID,
        ...(props.stage === "Test" ? { DECIDER_FIXED_RESPONSES: "ENABLED" } : {}),
      },
    });
    decisionApi.function.addToRolePolicy(
      new PolicyStatement({
        actions: ["dynamodb:GetItem", "dynamodb:PutItem"],
        resources: [gameSessions.table.tableArn, playerStats.table.tableArn],
      }),
    );
    decisionApi.function.addToRolePolicy(
      new PolicyStatement({
        actions: ["dynamodb:PutItem"],
        resources: [seatAssignments.table.tableArn],
      }),
    );
    decisionApi.function.addToRolePolicy(
      new PolicyStatement({
        actions: ["dynamodb:Query"],
        resources: [preferences.table.tableArn],
      }),
    );
    decisionApi.function.addToRolePolicy(
      new PolicyStatement({
        actions: ["dynamodb:UpdateItem"],
        resources: [props.stateful.rateLimits.table.tableArn],
      }),
    );
    decisionApi.function.addToRolePolicy(
      new PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: [
          this.formatArn({
            service: "bedrock",
            resource: "inference-profile",
            resourceName: DECIDER_MODEL_ID,
          }),
          ...DECIDER_MODEL_REGIONS.map((region) =>
            this.formatArn({
              service: "bedrock",
              region,
              account: "",
              resource: "foundation-model",
              resourceName: DECIDER_MODEL_ID.replace(/^us\./, ""),
            }),
          ),
        ],
      }),
    );
    this.api.addBundle("Decisions", decisionsRoutes, decisionApi.function);
    this.api.throttleRoutes({ "POST /v1/decisions": { rateLimit: 50, burstLimit: 100 } });
    this.addAlarms(props.stage, { decisionApi, gameApi });
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
    this.webClientId = new CfnOutput(this, "WebClientId", {
      value: this.webClient.userPoolClientId,
    });
  }

  /** The stage's alarms (cdk-stacks.md section 9.1); the rollup's join with DM-5. */
  private addAlarms(
    stage: StageName,
    functions: { decisionApi: AllPlayFunction; gameApi: AllPlayFunction },
  ): void {
    const fiveMinutes = Duration.minutes(5);
    for (const [name, fn] of Object.entries(functions)) {
      new AllPlayAlarm(this, `${name}Errors`, {
        stage,
        name: `${name.charAt(0).toUpperCase()}${name.slice(1)}Errors`,
        metric: fn.function.metricErrors({ period: fiveMinutes, statistic: "Sum" }),
        threshold: 5,
        description: `${fn.function.functionName} failed at least 5 times in 5 minutes.`,
      });
    }
    new AllPlayAlarm(this, "Api5xx", {
      stage,
      name: "Api5xx",
      metric: new Metric({
        namespace: "AWS/ApiGateway",
        metricName: "5xx",
        dimensionsMap: { ApiId: this.api.api.apiId, Stage: "$default" },
        period: fiveMinutes,
        statistic: "Sum",
      }),
      threshold: 10,
      description: "The API answered at least 10 server errors in 5 minutes.",
    });
    const throttled = new MetricFilter(this, "BedrockThrottled", {
      logGroup: functions.decisionApi.logGroup,
      filterPattern: FilterPattern.literal('"BEDROCK_THROTTLED"'),
      metricNamespace: PROJECT_NAME,
      metricName: `BedrockThrottled${stage}`,
      metricValue: "1",
    });
    new AllPlayAlarm(this, "BedrockThrottledAlarm", {
      stage,
      name: "BedrockThrottled",
      metric: throttled.metric({ period: fiveMinutes, statistic: "Sum" }),
      threshold: 5,
      description: "Bedrock throttled the decider at least 5 times in 5 minutes.",
    });
  }
}

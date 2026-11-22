import { Stack, Validations, type StackProps } from "aws-cdk-lib";
import { CfnBudget } from "aws-cdk-lib/aws-budgets";
import { BuildSpec, ComputeType, LinuxArmBuildImage } from "aws-cdk-lib/aws-codebuild";
import { PipelineNotificationEvents, PipelineType } from "aws-cdk-lib/aws-codepipeline";
import { PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Schedule, ScheduleExpression } from "aws-cdk-lib/aws-scheduler";
import { CodePipelineStartPipelineExecution } from "aws-cdk-lib/aws-scheduler-targets";
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import {
  CodeBuildStep,
  CodePipeline,
  CodePipelineSource,
  ShellStep,
  type IFileSetProducer,
} from "aws-cdk-lib/pipelines";
import type { Construct } from "constructs";
import { acknowledgeGenerated } from "../nag";
import { PROJECT_NAME, resourceName, STAGE_NAMES, type StageName } from "../config";
import { AllPlayStage } from "../stage";

export interface AllPlayPipelineStackProps extends StackProps {
  /** Directory holding the web app's production build. */
  webAssetPath: string;
}

/** GitHub source (cdk-stacks.md section 7). The connection ARN lives in SSM so the public repo holds no account ids. */
export const REPOSITORY = "seththeeke/allplay";
export const BRANCH = "main";
export const CONNECTION_PARAMETER = "/allplay/github-connection-arn";
export const MONTHLY_BUDGET_USD = 25;
/** The one place the alert address is defined (cdk-stacks.md section 9.1). */
export const ALERT_EMAIL = "seththeeke@gmail.com";
export const CDK_CLI_VERSION = "2.1148.1";

/** Lint, unit tests with coverage gates, builds, then synth with cdk-nag, all from the repository root. */
export const SYNTH_COMMANDS = [
  "npm ci --prefix backend",
  "npm ci --prefix web-app",
  "npm ci --prefix cdk",
  "npm run lint",
  "npm test",
  "npm run build",
  "cd cdk && npx cdk synth --quiet",
];

/**
 * Read-only checks against a deployed stage: the API integration tests, then
 * the web app's entry page, a deep link, and config.json pointing at the API.
 */
export function verifyCommands(): string[] {
  return [
    "npm ci --prefix backend",
    'WEB_ORIGIN="$WEB_URL" npm run test:integration --prefix backend',
    `curl -fsS "$WEB_URL/" | grep -q 'id="root"'`,
    `curl -fsS "$WEB_URL/health" | grep -q 'id="root"'`,
    'curl -fsS "$WEB_URL/config.json" | grep -q "$API_URL"',
  ];
}

/* Findings on the CDK Pipelines construct, which generates its own roles, projects and artifact bucket. */
const PIPELINE_ACKNOWLEDGED: readonly (readonly [string, string])[] = [
  [
    "AwsSolutions-S1",
    "The pipeline artifact bucket holds build outputs only; access logs add cost without day 0 value (cdk-stacks.md section 9).",
  ],
  [
    "AwsSolutions-CB4",
    "CodeBuild output is encrypted with the artifact bucket's S3 managed key; a customer key adds a fixed monthly cost.",
  ],
];

const GENERATED_WILDCARDS =
  "CDK Pipelines generates the CodeBuild, CodePipeline and self-mutation roles with wildcards scoped to its own artifact bucket, log groups, report groups and the CDK bootstrap roles.";

/**
 * Account-level CI/CD and cost controls (cdk-stacks.md sections 7 and 9): the
 * self-mutating pipeline that deploys Test, verifies it, then deploys and
 * verifies Prod; a daily schedule in place of push triggers; the alert topic;
 * failure notifications; and the monthly budget.
 */
export class AllPlayPipelineStack extends Stack {
  readonly pipeline: CodePipeline;
  readonly stages: AllPlayStage[];
  readonly alerts: Topic;
  /** Wildcard findings acknowledged on the generated pipeline resources. */
  readonly acknowledgedWildcards: string[];

  constructor(scope: Construct, id: string, props: AllPlayPipelineStackProps) {
    super(scope, id, props);
    const connectionArn = StringParameter.valueForStringParameter(this, CONNECTION_PARAMETER);
    this.pipeline = new CodePipeline(this, "Pipeline", {
      pipelineName: PROJECT_NAME,
      pipelineType: PipelineType.V2,
      selfMutation: true,
      crossAccountKeys: false,
      cliVersion: CDK_CLI_VERSION,
      useChangeSets: false,
      /*
       * The casts bridge aws-cdk-lib's optional primaryOutput, which does not
       * satisfy IFileSetProducer under exactOptionalPropertyTypes.
       */
      synth: new ShellStep("Synth", {
        input: CodePipelineSource.connection(REPOSITORY, BRANCH, {
          connectionArn,
          triggerOnPush: false,
        }) as IFileSetProducer,
        commands: SYNTH_COMMANDS,
        primaryOutputDirectory: "cdk/cdk.out",
      }) as IFileSetProducer,
      codeBuildDefaults: {
        buildEnvironment: {
          buildImage: LinuxArmBuildImage.AMAZON_LINUX_2023_STANDARD_3_0,
          computeType: ComputeType.SMALL,
        },
        partialBuildSpec: BuildSpec.fromObject({
          phases: { install: { "runtime-versions": { nodejs: 22 } } },
        }),
      },
    });
    this.stages = STAGE_NAMES.map((stageName) => this.addStage(stageName, props.webAssetPath));
    this.pipeline.buildPipeline();

    this.alerts = new Topic(this, "Alerts", {
      topicName: `${PROJECT_NAME}-Alerts`,
      displayName: "All Play alerts",
      enforceSSL: true,
    });
    this.alerts.addSubscription(new EmailSubscription(ALERT_EMAIL));
    this.alerts.addToResourcePolicy(
      new PolicyStatement({
        actions: ["sns:Publish"],
        principals: [new ServicePrincipal("budgets.amazonaws.com")],
        resources: [this.alerts.topicArn],
        conditions: { StringEquals: { "aws:SourceAccount": this.account } },
      }),
    );
    const failures = this.pipeline.pipeline.notifyOn("PipelineFailed", this.alerts, {
      events: [PipelineNotificationEvents.PIPELINE_EXECUTION_FAILED],
    });
    /* The rule is rejected unless the topic policy granting CodeStar Notifications exists first. */
    failures.node.addDependency(this.alerts);

    new Schedule(this, "DailyRun", {
      scheduleName: `${PROJECT_NAME}-DailyPipelineRun`,
      description: "Runs the All Play pipeline daily at 10:00 UTC (cdk-stacks.md section 7).",
      schedule: ScheduleExpression.cron({ minute: "0", hour: "10" }),
      target: new CodePipelineStartPipelineExecution(this.pipeline.pipeline),
    });

    new CfnBudget(this, "Budget", {
      budget: {
        budgetName: `${PROJECT_NAME}-Monthly`,
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount: MONTHLY_BUDGET_USD, unit: "USD" },
      },
      notificationsWithSubscribers: [
        ["ACTUAL", 80],
        ["ACTUAL", 100],
        ["FORECASTED", 100],
      ].map(([notificationType, threshold]) => ({
        notification: {
          notificationType: notificationType as string,
          comparisonOperator: "GREATER_THAN",
          threshold: threshold as number,
          thresholdType: "PERCENTAGE",
        },
        subscribers: [{ subscriptionType: "SNS", address: this.alerts.topicArn }],
      })),
    });

    for (const [rule, reason] of PIPELINE_ACKNOWLEDGED) {
      Validations.of(this.pipeline).acknowledge({ id: rule, reason });
    }
    this.acknowledgedWildcards = acknowledgeGenerated(
      this.pipeline,
      "AwsSolutions-IAM5[",
      GENERATED_WILDCARDS,
    );
    Validations.of(this.alerts).acknowledge({
      id: "AwsSolutions-SNS2",
      reason:
        "Alerts carry no player data, and AWS Budgets cannot publish to a topic encrypted with the AWS managed key; a customer key costs more than the alerts justify.",
    });
  }

  private addStage(stageName: StageName, webAssetPath: string): AllPlayStage {
    const stage = new AllPlayStage(this, stageName, {
      stageName,
      webAssetPath,
      env: { region: this.region },
    });
    this.pipeline.addStage(stage, {
      post: [
        new CodeBuildStep(`Verify${stageName}`, {
          envFromCfnOutputs: {
            API_URL: stage.app.apiUrl,
            WEB_URL: stage.app.webUrl,
            PLAYERS_TABLE: stage.stateful.playersTableName,
            PREFERENCES_TABLE: stage.stateful.preferencesTableName,
            MERGE_TOKENS_TABLE: stage.stateful.mergeTokensTableName,
            GAME_SESSIONS_TABLE: stage.stateful.gameSessionsTableName,
            SEAT_ASSIGNMENTS_TABLE: stage.stateful.seatAssignmentsTableName,
            PLAYER_STATS_TABLE: stage.stateful.playerStatsTableName,
            RATE_LIMITS_TABLE: stage.stateful.rateLimitsTableName,
            USER_POOL_ID: stage.stateful.userPoolId,
            USER_POOL_CLIENT_ID: stage.app.webClientId,
            IDENTITY_POOL_ID: stage.app.identity.identityPoolIdOutput,
          },
          /* Tests that write data run only against Test; Prod gets the read-only checks. */
          env: {
            EXPECTED_STAGE: stageName,
            ...(stageName === "Test"
              ? { INTEGRATION_ACCOUNTS_ROLE: resourceName("IntegrationAccounts", stageName) }
              : {}),
            INTEGRATION_SCOPE: stageName === "Test" ? "stage" : "readonly",
          },
          rolePolicyStatements: stage.verifyGrants.map((grant) => grant(this)),
          commands: verifyCommands(),
        }),
      ],
    });
    return stage;
  }
}

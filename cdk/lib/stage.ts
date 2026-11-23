import { Stage, Tags, type Stack, type StageProps } from "aws-cdk-lib";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";
import { PROJECT_NAME, resourceName, stackName, type StageName } from "./config";

/**
 * A permission the stage's verification step needs, built in the pipeline's
 * own stack from fixed resource names, because a reference into the stage's
 * stacks cannot cross the stage boundary.
 */
export type VerifyGrant = (pipeline: Stack) => PolicyStatement;
import { AllPlayAppStack } from "./stacks/AllPlayAppStack";
import { AllPlayStatefulStack } from "./stacks/AllPlayStatefulStack";

export interface AllPlayStageProps extends StageProps {
  stageName: StageName;
  /** Directory holding the web app's production build. */
  webAssetPath: string;
}

/** One deployment of All Play: the stateful stack and the app stack (cdk-stacks.md section 2). */
export class AllPlayStage extends Stage {
  readonly stateful: AllPlayStatefulStack;
  readonly app: AllPlayAppStack;
  /**
   * Permissions the stage's verification step needs (cdk-stacks.md section 7),
   * added by the constructs that integration tests exercise, such as a table
   * the Test stage's write tests read and clean up. Empty until those exist.
   */
  readonly verifyGrants: VerifyGrant[] = [];

  constructor(scope: Construct, id: string, props: AllPlayStageProps) {
    super(scope, id, props);
    const stage = props.stageName;
    /* explicitStackTags (cdk.json) applies stack tags only when passed to the stack itself. */
    const tags = { Project: PROJECT_NAME, Stage: stage };
    this.stateful = new AllPlayStatefulStack(this, "Stateful", {
      stackName: stackName("Stateful", stage),
      stage,
      tags,
    });
    this.app = new AllPlayAppStack(this, "App", {
      stackName: stackName("App", stage),
      stage,
      tags,
      stateful: this.stateful,
      webAssetPath: props.webAssetPath,
    });
    /* Only Test's verification writes data; Prod's is read-only (cdk-stacks.md section 7). */
    if (stage === "Test") {
      /* Each table with the indexes its tests query, named so the grant has no wildcard. */
      const tables: [string, string[]][] = [
        [resourceName("Players", stage), ["ByEmail"]],
        [resourceName("Preferences", stage), []],
        [resourceName("MergeTokens", stage), []],
        [resourceName("GameSessions", stage), []],
        [resourceName("SeatAssignments", stage), ["ByPlayerGame"]],
        [resourceName("PlayerStats", stage), []],
        [resourceName("RateLimits", stage), []],
        [resourceName("MetricRollups", stage), []],
        [resourceName("ConversationMessages", stage), []],
      ];
      /* The Test-only role that manages integration test accounts (AllPlayStatefulStack). */
      this.verifyGrants.push(
        (pipeline) =>
          new PolicyStatement({
            actions: ["sts:AssumeRole"],
            resources: [
              pipeline.formatArn({
                service: "iam",
                region: "",
                resource: "role",
                resourceName: resourceName("IntegrationAccounts", stage),
              }),
            ],
          }),
      );
      this.verifyGrants.push(
        (pipeline) =>
          new PolicyStatement({
            actions: [
              "dynamodb:GetItem",
              "dynamodb:PutItem",
              "dynamodb:UpdateItem",
              "dynamodb:DeleteItem",
              "dynamodb:Query",
            ],
            resources: tables.flatMap(([name, indexes]) => {
              const arn = pipeline.formatArn({
                service: "dynamodb",
                resource: "table",
                resourceName: name,
              });
              return [arn, ...indexes.map((index) => `${arn}/index/${index}`)];
            }),
          }),
      );
      /*
       * The player DAO contract checks the admin duplicate list (a scan of
       * ByEmail) and the daily rollup's one scan of the table.
       */
      this.verifyGrants.push((pipeline) => {
        const players = pipeline.formatArn({
          service: "dynamodb",
          resource: "table",
          resourceName: resourceName("Players", stage),
        });
        return new PolicyStatement({
          actions: ["dynamodb:Scan"],
          resources: [players, `${players}/index/ByEmail`],
        });
      });
    }
    Tags.of(this).add("Project", PROJECT_NAME);
    Tags.of(this).add("Stage", stage);
  }
}

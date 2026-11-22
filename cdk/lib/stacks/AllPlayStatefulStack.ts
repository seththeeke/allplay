import { CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import { AccountRootPrincipal, PolicyStatement, Role } from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";
import { isProd, resourceName, type StageName } from "../config";
import { AllPlayTable } from "../constructs/AllPlayTable";
import { AllPlayUserPool } from "../constructs/AllPlayUserPool";
import { FederationSecret } from "../constructs/FederationSecret";

export interface AllPlayStatefulStackProps extends StackProps {
  stage: StageName;
}

/**
 * Player data and identities: DynamoDB tables, the Cognito User Pool and the
 * Identity Pool (cdk-stacks.md section 2). Termination protection is on in
 * Prod. Resources are added by the DM-* and AA-* legs.
 */
export class AllPlayStatefulStack extends Stack {
  readonly stage: StageName;
  /** Google and Apple sign-in credentials, set by hand (authn-authz.md section 3.1); the User Pool reads them in AA-3. */
  readonly federation: FederationSecret;
  /** Guests and accounts (data-model.md section 4). */
  readonly players: AllPlayTable;
  /** Layered preferences (data-model.md section 5). */
  readonly preferences: AllPlayTable;
  /** Single-use merge proofs, kept 10 minutes (data-model.md section 9). */
  readonly mergeTokens: AllPlayTable;
  /** One game from deal to finish (data-model.md section 6). */
  readonly gameSessions: AllPlayTable;
  /** Which sessions a player sits in, with the resume index (data-model.md section 7). */
  readonly seatAssignments: AllPlayTable;
  /** Results per player, game and variant (data-model.md section 8). */
  readonly playerStats: AllPlayTable;
  /** Per-player decision counters (data-model.md section 10). */
  readonly rateLimits: AllPlayTable;
  /** Daily aggregates for /admin (data-model.md section 11). */
  readonly metricRollups: AllPlayTable;
  /** Accounts and groups (authn-authz.md section 3). */
  readonly users: AllPlayUserPool;
  readonly playersTableName: CfnOutput;
  readonly preferencesTableName: CfnOutput;
  readonly mergeTokensTableName: CfnOutput;
  readonly gameSessionsTableName: CfnOutput;
  readonly seatAssignmentsTableName: CfnOutput;
  readonly playerStatsTableName: CfnOutput;
  readonly rateLimitsTableName: CfnOutput;
  readonly metricRollupsTableName: CfnOutput;
  readonly userPoolId: CfnOutput;

  constructor(scope: Construct, id: string, props: AllPlayStatefulStackProps) {
    super(scope, id, { ...props, terminationProtection: isProd(props.stage) });
    this.stage = props.stage;
    this.federation = new FederationSecret(this, "Federation", { stage: props.stage });
    this.players = new AllPlayTable(this, "Players", {
      stage: props.stage,
      entity: "Players",
      partitionKey: { name: "playerId" },
      timeToLiveAttribute: "ttl",
      globalIndexes: [
        {
          indexName: "ByEmail",
          partitionKey: { name: "emailKey" },
          sortKey: { name: "createdAt" },
          projection: { include: ["status", "signInProviders"] },
        },
      ],
    });
    this.preferences = new AllPlayTable(this, "Preferences", {
      stage: props.stage,
      entity: "Preferences",
      partitionKey: { name: "playerId" },
      sortKey: { name: "scope" },
      timeToLiveAttribute: "ttl",
    });
    this.mergeTokens = new AllPlayTable(this, "MergeTokens", {
      stage: props.stage,
      entity: "MergeTokens",
      partitionKey: { name: "tokenHash" },
      timeToLiveAttribute: "ttl",
    });
    this.gameSessions = new AllPlayTable(this, "GameSessions", {
      stage: props.stage,
      entity: "GameSessions",
      partitionKey: { name: "sessionId" },
      timeToLiveAttribute: "ttl",
    });
    this.seatAssignments = new AllPlayTable(this, "SeatAssignments", {
      stage: props.stage,
      entity: "SeatAssignments",
      partitionKey: { name: "playerId" },
      sortKey: { name: "sessionId" },
      timeToLiveAttribute: "ttl",
      globalIndexes: [
        {
          indexName: "ByPlayerGame",
          partitionKey: { name: "playerGameKey" },
          sortKey: { name: "statusSortKey" },
          projection: "ALL",
        },
      ],
    });
    this.playerStats = new AllPlayTable(this, "PlayerStats", {
      stage: props.stage,
      entity: "PlayerStats",
      partitionKey: { name: "playerId" },
      sortKey: { name: "statsKey" },
      timeToLiveAttribute: "ttl",
    });
    this.rateLimits = new AllPlayTable(this, "RateLimits", {
      stage: props.stage,
      entity: "RateLimits",
      partitionKey: { name: "counterKey" },
      timeToLiveAttribute: "ttl",
    });
    this.metricRollups = new AllPlayTable(this, "MetricRollups", {
      stage: props.stage,
      entity: "MetricRollups",
      partitionKey: { name: "rollupType" },
      sortKey: { name: "period" },
    });
    const domainSuffix = this.node.tryGetContext("allplay:authDomainSuffix") as string | undefined;
    if (domainSuffix === undefined) throw new Error("Set allplay:authDomainSuffix in cdk.json.");
    this.users = new AllPlayUserPool(this, "Users", {
      stage: props.stage,
      domainSuffix,
      players: this.players.table,
    });
    /* Table names for the pipeline's integration tests (cdk-stacks.md section 7). */
    this.playersTableName = new CfnOutput(this, "PlayersTableName", {
      value: this.players.table.tableName,
    });
    this.preferencesTableName = new CfnOutput(this, "PreferencesTableName", {
      value: this.preferences.table.tableName,
    });
    this.mergeTokensTableName = new CfnOutput(this, "MergeTokensTableName", {
      value: this.mergeTokens.table.tableName,
    });
    this.gameSessionsTableName = new CfnOutput(this, "GameSessionsTableName", {
      value: this.gameSessions.table.tableName,
    });
    this.seatAssignmentsTableName = new CfnOutput(this, "SeatAssignmentsTableName", {
      value: this.seatAssignments.table.tableName,
    });
    this.playerStatsTableName = new CfnOutput(this, "PlayerStatsTableName", {
      value: this.playerStats.table.tableName,
    });
    this.rateLimitsTableName = new CfnOutput(this, "RateLimitsTableName", {
      value: this.rateLimits.table.tableName,
    });
    this.metricRollupsTableName = new CfnOutput(this, "MetricRollupsTableName", {
      value: this.metricRollups.table.tableName,
    });
    this.userPoolId = new CfnOutput(this, "UserPoolId", { value: this.users.userPool.userPoolId });
    if (props.stage === "Test") {
      /*
       * Test's verification creates throwaway accounts (authn-authz.md section
       * 10). It assumes this role by its fixed name, so the pipeline's policy
       * needs neither a wildcard nor a reference into this stack.
       */
      const role = new Role(this, "IntegrationAccounts", {
        roleName: resourceName("IntegrationAccounts", props.stage),
        assumedBy: new AccountRootPrincipal(),
        description: "Test stage integration tests: create, group and delete test accounts.",
      });
      role.addToPolicy(
        new PolicyStatement({
          actions: [
            "cognito-idp:AdminCreateUser",
            "cognito-idp:AdminSetUserPassword",
            "cognito-idp:AdminAddUserToGroup",
            "cognito-idp:AdminDeleteUser",
          ],
          resources: [this.users.userPool.userPoolArn],
        }),
      );
    }
  }
}

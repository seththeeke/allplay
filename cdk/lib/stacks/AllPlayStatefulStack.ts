import { CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import type { Construct } from "constructs";
import { isProd, type StageName } from "../config";
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
  /** Single-use merge proofs, kept 10 minutes (data-model.md section 10). */
  readonly mergeTokens: AllPlayTable;
  /** Accounts and groups (authn-authz.md section 3). */
  readonly users: AllPlayUserPool;
  readonly playersTableName: CfnOutput;
  readonly preferencesTableName: CfnOutput;
  readonly mergeTokensTableName: CfnOutput;

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
  }
}

import { RemovalPolicy, Validations } from "aws-cdk-lib";
import { AttributeType, Billing, ProjectionType, TableV2 } from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import { isProd, resourceName, type StageName } from "../config";

export interface TableKey {
  name: string;
  type?: "STRING" | "NUMBER" | "BINARY";
}

export interface TableIndex {
  indexName: string;
  partitionKey: TableKey;
  sortKey?: TableKey;
  projection: "ALL" | "KEYS_ONLY" | { include: string[] };
}

export interface AllPlayTableProps {
  stage: StageName;
  /** Entity name from data-model.md, for example `Players`; the table is `AllPlay-<entity>-<Stage>`. */
  entity: string;
  partitionKey: TableKey;
  sortKey?: TableKey;
  timeToLiveAttribute?: string;
  globalIndexes?: TableIndex[];
}

function attribute(key: TableKey): { name: string; type: AttributeType } {
  const type = key.type ?? "STRING";
  return { name: key.name, type: AttributeType[type] };
}

function projection(index: TableIndex): {
  projectionType: ProjectionType;
  nonKeyAttributes?: string[];
} {
  if (index.projection === "ALL") return { projectionType: ProjectionType.ALL };
  if (index.projection === "KEYS_ONLY") return { projectionType: ProjectionType.KEYS_ONLY };
  return { projectionType: ProjectionType.INCLUDE, nonKeyAttributes: index.projection.include };
}

/**
 * DynamoDB table with All Play defaults (data-model.md section 1): on-demand
 * billing, stage-suffixed name, retained on deletion, and point-in-time
 * recovery plus deletion protection in Prod.
 */
export class AllPlayTable extends Construct {
  readonly table: TableV2;

  constructor(scope: Construct, id: string, props: AllPlayTableProps) {
    super(scope, id);
    const prod = isProd(props.stage);
    this.table = new TableV2(this, "Table", {
      tableName: resourceName(props.entity, props.stage),
      partitionKey: attribute(props.partitionKey),
      ...(props.sortKey === undefined ? {} : { sortKey: attribute(props.sortKey) }),
      billing: Billing.onDemand(),
      removalPolicy: RemovalPolicy.RETAIN,
      deletionProtection: prod,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: prod },
      ...(props.timeToLiveAttribute === undefined
        ? {}
        : { timeToLiveAttribute: props.timeToLiveAttribute }),
      globalSecondaryIndexes: (props.globalIndexes ?? []).map((index) => ({
        indexName: index.indexName,
        partitionKey: attribute(index.partitionKey),
        ...(index.sortKey === undefined ? {} : { sortKey: attribute(index.sortKey) }),
        ...projection(index),
      })),
    });
    if (!prod) {
      Validations.of(this.table).acknowledge({
        id: "AwsSolutions-DDB3",
        reason:
          "Point-in-time recovery is enabled in Prod only; Test data is disposable (data-model.md section 1).",
      });
    }
  }
}

import { Stack, type StackProps } from "aws-cdk-lib";
import type { Construct } from "constructs";
import { isProd, type StageName } from "../config";

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

  constructor(scope: Construct, id: string, props: AllPlayStatefulStackProps) {
    super(scope, id, { ...props, terminationProtection: isProd(props.stage) });
    this.stage = props.stage;
  }
}

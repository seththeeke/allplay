import { Stack, type StackProps } from "aws-cdk-lib";
import type { Construct } from "constructs";

/**
 * Account-level CI/CD and cost controls: the self-mutating pipeline, daily
 * schedule, budget and alert topic (cdk-stacks.md section 7). Built in CDK-5.
 */
export class AllPlayPipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);
  }
}

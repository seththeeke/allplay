import { Stack, type StackProps } from "aws-cdk-lib";
import type { Construct } from "constructs";
import type { StageName } from "../config";
import type { AllPlayStatefulStack } from "./AllPlayStatefulStack";

export interface AllPlayAppStackProps extends StackProps {
  stage: StageName;
  stateful: AllPlayStatefulStack;
}

/**
 * The replaceable application: API, Lambdas, scheduled jobs and web hosting
 * (cdk-stacks.md section 2). It depends on the stateful stack, never the
 * reverse. Resources are added by later legs.
 */
export class AllPlayAppStack extends Stack {
  readonly stage: StageName;

  constructor(scope: Construct, id: string, props: AllPlayAppStackProps) {
    super(scope, id, props);
    this.stage = props.stage;
    this.addStackDependency(props.stateful);
  }
}

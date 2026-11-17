import { Stage, Tags, type StageProps } from "aws-cdk-lib";
import type { Construct } from "constructs";
import { PROJECT_NAME, stackName, type StageName } from "./config";
import { AllPlayAppStack } from "./stacks/AllPlayAppStack";
import { AllPlayStatefulStack } from "./stacks/AllPlayStatefulStack";

export interface AllPlayStageProps extends StageProps {
  stageName: StageName;
}

/** One deployment of All Play: the stateful stack and the app stack (cdk-stacks.md section 2). */
export class AllPlayStage extends Stage {
  readonly stateful: AllPlayStatefulStack;
  readonly app: AllPlayAppStack;

  constructor(scope: Construct, id: string, props: AllPlayStageProps) {
    super(scope, id, props);
    const stage = props.stageName;
    this.stateful = new AllPlayStatefulStack(this, "Stateful", {
      stackName: stackName("Stateful", stage),
      stage,
    });
    this.app = new AllPlayAppStack(this, "App", {
      stackName: stackName("App", stage),
      stage,
      stateful: this.stateful,
    });
    Tags.of(this).add("Project", PROJECT_NAME);
    Tags.of(this).add("Stage", stage);
  }
}

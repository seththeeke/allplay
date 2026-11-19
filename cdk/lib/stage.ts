import { Stage, Tags, type StageProps } from "aws-cdk-lib";
import type { Construct } from "constructs";
import { PROJECT_NAME, stackName, type StageName } from "./config";
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
    Tags.of(this).add("Project", PROJECT_NAME);
    Tags.of(this).add("Stage", stage);
  }
}

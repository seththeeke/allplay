import { Validations, type App } from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import { DEFAULT_REGION } from "./config";
import { WEB_DIST_DIR } from "./paths";
import { AllPlayPipelineStack } from "./stacks/AllPlayPipelineStack";
import type { AllPlayStage } from "./stage";

export interface BuiltApp {
  pipeline: AllPlayPipelineStack;
  stages: AllPlayStage[];
}

/** The web build to publish: context `allplay:webAssetPath` when set (tests), else `web-app/dist`. */
export function webAssetPathFor(app: App): string {
  return (app.node.tryGetContext("allplay:webAssetPath") as string | undefined) ?? WEB_DIST_DIR;
}

/**
 * Adds the pipeline stack, which holds the Test and Prod stages it deploys.
 * A stage can also be deployed by hand as `AllPlayPipeline/<Stage>/*`. No
 * account is set, so synth never needs AWS credentials.
 */
export function buildApp(app: App): BuiltApp {
  const region = (app.node.tryGetContext("allplay:region") as string | undefined) ?? DEFAULT_REGION;
  const pipeline = new AllPlayPipelineStack(app, "AllPlayPipeline", {
    stackName: "AllPlayPipeline",
    env: { region },
    webAssetPath: webAssetPathFor(app),
  });
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: true }));
  return { pipeline, stages: pipeline.stages };
}

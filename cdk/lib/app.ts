import { Validations, type App } from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import { DEFAULT_REGION, STAGE_NAMES } from "./config";
import { WEB_DIST_DIR } from "./paths";
import { AllPlayPipelineStack } from "./stacks/AllPlayPipelineStack";
import { AllPlayStage } from "./stage";

export interface BuiltApp {
  pipeline: AllPlayPipelineStack;
  stages: AllPlayStage[];
}

/** The web build to publish: context `allplay:webAssetPath` when set (tests), else `web-app/dist`. */
export function webAssetPathFor(app: App): string {
  return (app.node.tryGetContext("allplay:webAssetPath") as string | undefined) ?? WEB_DIST_DIR;
}

/**
 * Adds every All Play stack to the app. Stages are instantiated directly for
 * local synth until CDK-5 moves them into the pipeline. No account is set, so
 * synth never needs AWS credentials.
 */
export function buildApp(app: App): BuiltApp {
  const region = (app.node.tryGetContext("allplay:region") as string | undefined) ?? DEFAULT_REGION;
  const pipeline = new AllPlayPipelineStack(app, "AllPlayPipeline", {
    stackName: "AllPlayPipeline",
    env: { region },
  });
  const webAssetPath = webAssetPathFor(app);
  const stages = STAGE_NAMES.map(
    (stageName) => new AllPlayStage(app, stageName, { stageName, webAssetPath, env: { region } }),
  );
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: true }));
  return { pipeline, stages };
}

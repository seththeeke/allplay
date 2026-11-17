/** Stage names and naming helpers shared by every stack and construct (cdk-stacks.md section 1). */

export const STAGE_NAMES = ["Test", "Prod"] as const;

export type StageName = (typeof STAGE_NAMES)[number];

export const PROJECT_NAME = "AllPlay";

export const DEFAULT_REGION = "us-east-1";

/** Physical name for a stage-scoped resource, for example `AllPlay-Players-Test`. */
export function resourceName(base: string, stage: StageName): string {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(base)) {
    throw new Error(`Resource base name must be alphanumeric PascalCase, got '${base}'`);
  }
  return `${PROJECT_NAME}-${base}-${stage}`;
}

/** Stack name for a stage, for example `AllPlayStateful-Test`. */
export function stackName(kind: "Stateful" | "App", stage: StageName): string {
  return `${PROJECT_NAME}${kind}-${stage}`;
}

export function isProd(stage: StageName): boolean {
  return stage === "Prod";
}

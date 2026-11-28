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

/** Who may play a stage (productionalization.md section 3). */
export type AccessMode = "OPEN" | "INVITE_ONLY";

/** Every difference between Test and Prod (productionalization.md section 2). */
export interface StageSettings {
  accessMode: AccessMode;
  /** Games per window for a player without their own limit: `5/DAY` or `UNLIMITED` (section 5). */
  defaultGameLimit: string;
}

export const STAGE_SETTINGS: Readonly<Record<StageName, StageSettings>> = {
  Test: { accessMode: "INVITE_ONLY", defaultGameLimit: "UNLIMITED" },
  Prod: { accessMode: "OPEN", defaultGameLimit: "5/DAY" },
};

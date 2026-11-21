import type { Deployment, DeploymentsResponse } from "../../models/api";
import {
  createCodePipelineDeployments,
  type DeploymentPipeline,
  type PipelineAction,
} from "../../dao/pipeline/deploymentPipeline";

/** How many runs `GET /v1/admin/deployments` lists (authn-authz.md section 5). */
export const RECENT_DEPLOYMENTS = 20;
/** The pipeline's name (cdk-stacks.md section 3). */
export const PIPELINE_NAME = "AllPlay";

type Status = Deployment["status"];

/** CodePipeline's run and action statuses in the contract's terms; a stopping run is still running. */
export function statusOf(status: string): Status {
  switch (status) {
    case "Succeeded":
      return "SUCCEEDED";
    case "Failed":
      return "FAILED";
    case "Superseded":
      return "SUPERSEDED";
    case "Stopped":
    case "Cancelled":
    case "Abandoned":
      return "STOPPED";
    default:
      return "IN_PROGRESS";
  }
}

/** Who started a run: the daily schedule's role, the admin API's role, or anyone else. */
export function triggerOf(startedBy: string): Deployment["trigger"] {
  if (startedBy.includes("SchedulerRoleForTarget")) return "SCHEDULE";
  if (startedBy.includes("-AdminApiRole")) return "ADMIN";
  return "MANUAL";
}

/** Folds actions into stages in the order they started: any failure fails a stage, then any running action. */
export function stagesOf(actions: PipelineAction[]): Deployment["stages"] {
  const byStage = new Map<string, { first: number; statuses: Status[] }>();
  for (const action of actions) {
    const stage = byStage.get(action.stageName) ?? { first: Infinity, statuses: [] };
    stage.first = Math.min(stage.first, action.startedAt.getTime());
    stage.statuses.push(statusOf(action.status));
    byStage.set(action.stageName, stage);
  }
  const rank: Status[] = ["FAILED", "IN_PROGRESS", "STOPPED", "SUPERSEDED", "SUCCEEDED"];
  return [...byStage.entries()]
    .sort(([, a], [, b]) => a.first - b.first)
    .map(([name, stage]) => ({
      name,
      status: rank.find((status) => stage.statuses.includes(status)) ?? "SUCCEEDED",
    }));
}

export interface DeploymentService {
  recent(): Promise<DeploymentsResponse>;
  start(): Promise<string>;
}

/** Pipeline runs for the admin page (authn-authz.md section 5). */
export function createDeploymentService(pipeline: DeploymentPipeline): DeploymentService {
  return {
    recent: async () => {
      const runs = await pipeline.recentRuns(RECENT_DEPLOYMENTS);
      const deployments = await Promise.all(
        runs.map(async (run): Promise<Deployment> => ({
          executionId: run.executionId,
          status: statusOf(run.status),
          trigger: triggerOf(run.startedBy),
          startedAt: run.startedAt.toISOString(),
          lastUpdatedAt: run.lastUpdatedAt.toISOString(),
          stages: stagesOf(await pipeline.actionsOf(run.executionId)),
        })),
      );
      return { deployments };
    },
    start: () => pipeline.start(),
  };
}

/** The deployed admin Lambda's service over the All Play pipeline. */
export function createDeployedDeploymentService(): DeploymentService {
  return createDeploymentService(createCodePipelineDeployments(PIPELINE_NAME));
}

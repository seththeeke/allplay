import type { DeploymentPipeline, PipelineAction, PipelineRun } from "./deploymentPipeline";

/** The pipeline in memory, for the local server and tests: a start adds a run in progress. */
export function createInMemoryDeploymentPipeline(
  now: () => Date = () => new Date(),
  runs: PipelineRun[] = [],
  actions: Record<string, PipelineAction[]> = {},
): DeploymentPipeline {
  return {
    recentRuns: (limit) => Promise.resolve(runs.slice(0, limit)),
    actionsOf: (executionId) => Promise.resolve(actions[executionId] ?? []),
    start: () => {
      const at = now();
      const executionId = `local-execution-${String(runs.length + 1)}`;
      runs.unshift({
        executionId,
        status: "InProgress",
        startedBy: "assumed-role/AllPlayApp-Local-AdminApiRole/local",
        startedAt: at,
        lastUpdatedAt: at,
      });
      actions[executionId] = [{ stageName: "Source", status: "InProgress", startedAt: at }];
      return Promise.resolve(executionId);
    },
  };
}

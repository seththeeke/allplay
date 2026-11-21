import {
  CodePipelineClient,
  ListActionExecutionsCommand,
  ListPipelineExecutionsCommand,
  StartPipelineExecutionCommand,
  type ActionExecutionDetail,
  type PipelineExecutionSummary,
} from "@aws-sdk/client-codepipeline";

/** One pipeline run as CodePipeline reports it. */
export interface PipelineRun {
  executionId: string;
  /** CodePipeline's status, such as `InProgress` or `Succeeded`. */
  status: string;
  /** Who started it: the IAM user or assumed role ARN. */
  startedBy: string;
  startedAt: Date;
  lastUpdatedAt: Date;
}

/** One action of a run, which the service folds into stage results. */
export interface PipelineAction {
  stageName: string;
  status: string;
  startedAt: Date;
}

/**
 * The All Play pipeline (authn-authz.md section 5). A DAO-layer adapter, so
 * services never import the CodePipeline client.
 */
export interface DeploymentPipeline {
  /** The most recent runs, newest first. */
  recentRuns(limit: number): Promise<PipelineRun[]>;
  /** The actions of one run. */
  actionsOf(executionId: string): Promise<PipelineAction[]>;
  /** Starts a run and returns its execution id. */
  start(): Promise<string>;
}

/** The part of the CodePipeline client the adapter uses, so tests can stand in for it. */
export interface PipelineSender {
  send(command: object): Promise<unknown>;
}

const EPOCH = new Date(0);

/** The pipeline over CodePipeline. */
export function createCodePipelineDeployments(
  pipelineName: string,
  client: PipelineSender = new CodePipelineClient({}),
): DeploymentPipeline {
  return {
    recentRuns: async (limit) => {
      const out = (await client.send(
        new ListPipelineExecutionsCommand({ pipelineName, maxResults: limit }),
      )) as { pipelineExecutionSummaries?: PipelineExecutionSummary[] };
      return (out.pipelineExecutionSummaries ?? []).flatMap((summary) =>
        summary.pipelineExecutionId === undefined
          ? []
          : [
              {
                executionId: summary.pipelineExecutionId,
                status: summary.status ?? "Unknown",
                startedBy: summary.trigger?.triggerDetail ?? "",
                startedAt: summary.startTime ?? EPOCH,
                lastUpdatedAt: summary.lastUpdateTime ?? summary.startTime ?? EPOCH,
              },
            ],
      );
    },
    actionsOf: async (executionId) => {
      const actions: PipelineAction[] = [];
      let nextToken: string | undefined;
      do {
        const out = (await client.send(
          new ListActionExecutionsCommand({
            pipelineName,
            filter: { pipelineExecutionId: executionId },
            nextToken,
          }),
        )) as { actionExecutionDetails?: ActionExecutionDetail[]; nextToken?: string };
        for (const detail of out.actionExecutionDetails ?? [])
          if (detail.stageName !== undefined)
            actions.push({
              stageName: detail.stageName,
              status: detail.status ?? "Unknown",
              startedAt: detail.startTime ?? EPOCH,
            });
        nextToken = out.nextToken;
      } while (nextToken !== undefined);
      return actions;
    },
    start: async () => {
      const out = (await client.send(
        new StartPipelineExecutionCommand({ name: pipelineName }),
      )) as {
        pipelineExecutionId?: string;
      };
      if (out.pipelineExecutionId === undefined)
        throw new Error("CodePipeline returned no execution id.");
      return out.pipelineExecutionId;
    },
  };
}

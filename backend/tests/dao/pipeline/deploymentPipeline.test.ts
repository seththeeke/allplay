import {
  ListActionExecutionsCommand,
  ListPipelineExecutionsCommand,
  StartPipelineExecutionCommand,
} from "@aws-sdk/client-codepipeline";
import { describe, expect, it, vi } from "vitest";
import { createCodePipelineDeployments } from "../../../src/dao/pipeline/deploymentPipeline";

const T = new Date("2026-11-21T10:00:00.000Z");

describe("CodePipeline deployments", () => {
  it("lists runs, skipping ones without ids and filling missing fields", async () => {
    const send = vi.fn<(command: object) => Promise<unknown>>(() =>
      Promise.resolve({
        pipelineExecutionSummaries: [
          {
            pipelineExecutionId: "e-1",
            status: "Succeeded",
            trigger: { triggerDetail: "arn:aws:iam::1:user/a" },
            startTime: T,
            lastUpdateTime: T,
          },
          { pipelineExecutionId: "e-2", startTime: T },
          { pipelineExecutionId: "e-3" },
          { status: "Failed" },
        ],
      }),
    );
    const pipeline = createCodePipelineDeployments("AllPlay", { send });
    const runs = await pipeline.recentRuns(20);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(ListPipelineExecutionsCommand);
    expect((send.mock.calls[0]?.[0] as ListPipelineExecutionsCommand).input).toEqual({
      pipelineName: "AllPlay",
      maxResults: 20,
    });
    expect(runs.map((run) => [run.executionId, run.status, run.startedBy])).toEqual([
      ["e-1", "Succeeded", "arn:aws:iam::1:user/a"],
      ["e-2", "Unknown", ""],
      ["e-3", "Unknown", ""],
    ]);
    expect(runs[1]?.lastUpdatedAt).toEqual(T);
    expect(runs[2]?.startedAt.getTime()).toBe(0);
    const empty = createCodePipelineDeployments("AllPlay", { send: () => Promise.resolve({}) });
    expect(await empty.recentRuns(1)).toEqual([]);
  });

  it("pages through a run's actions", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        actionExecutionDetails: [{ stageName: "Source", status: "Succeeded", startTime: T }, {}],
        nextToken: "n",
      })
      .mockResolvedValueOnce({ actionExecutionDetails: [{ stageName: "Build" }] })
      .mockResolvedValueOnce({});
    const pipeline = createCodePipelineDeployments("AllPlay", { send });
    expect(await pipeline.actionsOf("e-1")).toEqual([
      { stageName: "Source", status: "Succeeded", startedAt: T },
      { stageName: "Build", status: "Unknown", startedAt: new Date(0) },
    ]);
    const second = send.mock.calls[1]?.[0] as ListActionExecutionsCommand;
    expect(second).toBeInstanceOf(ListActionExecutionsCommand);
    expect(second.input).toEqual({
      pipelineName: "AllPlay",
      filter: { pipelineExecutionId: "e-1" },
      nextToken: "n",
    });
    expect(await pipeline.actionsOf("e-2")).toEqual([]);
  });

  it("starts a run", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ pipelineExecutionId: "e-9" })
      .mockResolvedValueOnce({});
    const pipeline = createCodePipelineDeployments("AllPlay", { send });
    expect(await pipeline.start()).toBe("e-9");
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(StartPipelineExecutionCommand);
    await expect(pipeline.start()).rejects.toThrow("no execution id");
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  createDeployedDeploymentService,
  createDeploymentService,
  stagesOf,
  statusOf,
  triggerOf,
} from "../../../src/service/admin/deploymentService";
import { createInMemoryDeploymentPipeline } from "../../../src/dao/pipeline/inMemoryDeploymentPipeline";

const at = (minute: number) => new Date(Date.UTC(2026, 10, 21, 10, minute));

describe("deployment service", () => {
  it("maps CodePipeline statuses", () => {
    expect(
      [
        "Succeeded",
        "Failed",
        "Superseded",
        "Stopped",
        "Cancelled",
        "Abandoned",
        "InProgress",
        "Stopping",
      ].map(statusOf),
    ).toEqual([
      "SUCCEEDED",
      "FAILED",
      "SUPERSEDED",
      "STOPPED",
      "STOPPED",
      "STOPPED",
      "IN_PROGRESS",
      "IN_PROGRESS",
    ]);
  });

  it("names the trigger from who started the run", () => {
    expect(
      triggerOf("arn:aws:sts::1:assumed-role/AllPlayPipeline-SchedulerRoleForTarget20816-X/abc"),
    ).toBe("SCHEDULE");
    expect(
      triggerOf(
        "arn:aws:sts::1:assumed-role/AllPlayApp-Prod-AdminApiRoleC6E9-x/AllPlay-AdminApi-Prod",
      ),
    ).toBe("ADMIN");
    expect(triggerOf("arn:aws:iam::1:user/someone")).toBe("MANUAL");
    expect(triggerOf("")).toBe("MANUAL");
  });

  it("folds actions into stages in start order, a failure or a running action deciding", () => {
    expect(
      stagesOf([
        { stageName: "Test", status: "Succeeded", startedAt: at(5) },
        { stageName: "Test", status: "Failed", startedAt: at(6) },
        { stageName: "Build", status: "Succeeded", startedAt: at(1) },
        { stageName: "Prod", status: "InProgress", startedAt: at(9) },
        { stageName: "Prod", status: "Succeeded", startedAt: at(8) },
        { stageName: "Source", status: "Succeeded", startedAt: at(0) },
      ]),
    ).toEqual([
      { name: "Source", status: "SUCCEEDED" },
      { name: "Build", status: "SUCCEEDED" },
      { name: "Test", status: "FAILED" },
      { name: "Prod", status: "IN_PROGRESS" },
    ]);
  });

  it("lists recent runs with their stages and starts new ones", async () => {
    const pipeline = createInMemoryDeploymentPipeline(
      () => at(30),
      [
        {
          executionId: "e-1",
          status: "Succeeded",
          startedBy: "arn:aws:iam::1:user/someone",
          startedAt: at(0),
          lastUpdatedAt: at(20),
        },
      ],
      { "e-1": [{ stageName: "Source", status: "Succeeded", startedAt: at(0) }] },
    );
    const service = createDeploymentService(pipeline);
    expect(await service.start()).toBe("local-execution-2");
    const { deployments } = await service.recent();
    expect(deployments.map((d) => [d.executionId, d.status, d.trigger])).toEqual([
      ["local-execution-2", "IN_PROGRESS", "ADMIN"],
      ["e-1", "SUCCEEDED", "MANUAL"],
    ]);
    expect(deployments[1]?.stages).toEqual([{ name: "Source", status: "SUCCEEDED" }]);
    const fresh = createInMemoryDeploymentPipeline();
    expect(await fresh.actionsOf("none")).toEqual([]);
    expect(await fresh.start()).toBe("local-execution-1");
  });

  it("builds the deployed service without calling AWS", () => {
    vi.stubEnv("AWS_REGION", "us-east-1");
    expect(typeof createDeployedDeploymentService().recent).toBe("function");
    vi.unstubAllEnvs();
  });
});

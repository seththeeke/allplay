import { describe, expect, it, vi } from "vitest";
import { createAdminHandler } from "../../../../src/controller/web-api/admin/adminController";
import { createInMemoryDeploymentPipeline } from "../../../../src/dao/pipeline/inMemoryDeploymentPipeline";
import { devIdentity } from "../../../../src/local/eventAdapter";
import { createLogger } from "../../../../src/logger";
import { createDeploymentService } from "../../../../src/service/admin/deploymentService";
import { apiEvent } from "../apiEvent";

const AT = new Date("2026-11-21T10:00:00.000Z");

function asCaller(routeKey: string, tier: "guest" | "player" | "admin") {
  const event = apiEvent(routeKey) as { requestContext: Record<string, unknown> };
  event.requestContext["authorizer"] = { iam: devIdentity({ tier, id: "u-1" }) };
  return event;
}

describe("admin controller", () => {
  const handler = createAdminHandler({
    deployments: createDeploymentService(createInMemoryDeploymentPipeline(() => AT)),
    logger: createLogger({ write: vi.fn() }),
  });

  it("lets an admin start a deployment and then lists it", async () => {
    const started = await handler(asCaller("POST /v1/admin/deployments", "admin"));
    expect(started.statusCode).toBe(202);
    expect(JSON.parse(started.body)).toEqual({ executionId: "local-execution-1" });
    const listed = await handler(asCaller("GET /v1/admin/deployments", "admin"));
    expect(listed.statusCode).toBe(200);
    expect(JSON.parse(listed.body)).toEqual({
      deployments: [
        {
          executionId: "local-execution-1",
          status: "IN_PROGRESS",
          trigger: "ADMIN",
          startedAt: AT.toISOString(),
          lastUpdatedAt: AT.toISOString(),
          stages: [{ name: "Source", status: "IN_PROGRESS" }],
        },
      ],
    });
  });

  it("refuses guests and players with 403", async () => {
    for (const tier of ["guest", "player"] as const)
      for (const route of ["GET /v1/admin/deployments", "POST /v1/admin/deployments"])
        expect((await handler(asCaller(route, tier))).statusCode).toBe(403);
  });

  it("has a Lambda entry point", async () => {
    vi.stubEnv("AWS_REGION", "us-east-1");
    const { handler: entry } = await import("../../../../src/controller/web-api/admin/handler");
    expect(typeof entry).toBe("function");
    vi.unstubAllEnvs();
  });
});

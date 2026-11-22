import { describe, expect, it, vi } from "vitest";
import { createAdminHandler } from "../../../../src/controller/web-api/admin/adminController";
import { createInMemoryDeploymentPipeline } from "../../../../src/dao/pipeline/inMemoryDeploymentPipeline";
import { devIdentity } from "../../../../src/local/eventAdapter";
import { createLogger } from "../../../../src/logger";
import { createDeploymentService } from "../../../../src/service/admin/deploymentService";
import { createAccountAdminService } from "../../../../src/service/admin/accountAdminService";
import { createInMemoryMergeTokenDao } from "../../../../src/dao/mergeToken/inMemoryMergeTokenDao";
import { createInMemoryPlayerDao } from "../../../../src/dao/player/inMemoryPlayerDao";
import { createMergeService } from "../../../../src/service/player/mergeService";
import { createInMemoryMetricRollupDao } from "../../../../src/dao/metricRollup/inMemoryMetricRollupDao";
import type { LoggedTurnEvent } from "../../../../src/dao/turnLog/turnLogReader";
import { createMetricsAdminService } from "../../../../src/service/admin/metricsAdminService";
import { account } from "../../../dao/player/playerDaoContract";
import { apiEvent } from "../apiEvent";

const AT = new Date("2026-11-21T10:00:00.000Z");

function asCaller(routeKey: string, tier: "guest" | "player" | "admin") {
  const event = apiEvent(routeKey) as { requestContext: Record<string, unknown> };
  event.requestContext["authorizer"] = { iam: devIdentity({ tier, id: "u-1" }) };
  return event;
}

const players = createInMemoryPlayerDao();
const accounts = createAccountAdminService(
  players,
  createMergeService({ players, mergeTokens: createInMemoryMergeTokenDao(), steps: [] }),
);

const rollups = createInMemoryMetricRollupDao();
const turnEvents: LoggedTurnEvent[] = [
  {
    event: "TURN_DECIDED",
    decisionId: "d1",
    timestamp: "2026-11-21 09:00:00.000",
    gameId: "spider-solitaire",
    transcript: "deal",
    outcome: "UNRECOGNIZED",
    failureClass: "HARD",
  },
];

describe("admin controller", () => {
  const handler = createAdminHandler({
    deployments: createDeploymentService(createInMemoryDeploymentPipeline(() => AT)),
    accounts,
    metrics: createMetricsAdminService({
      rollups,
      turns: { day: () => Promise.resolve(turnEvents) },
    }),
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

  it("lists duplicate accounts and merges one, through the route and the operator task", async () => {
    await players.create(account("ACCT#old", "Pat@example.com", "2026-01-01T00:00:00.000Z"));
    await players.create(account("ACCT#new", "pat@example.com", "2026-02-01T00:00:00.000Z"));
    await players.create(account("ACCT#third", "pat@example.com", "2026-03-01T00:00:00.000Z"));
    await players.create(account("ACCT#solo", "solo@example.com"));
    await players.create({ ...account("ACCT#gone", "solo@example.com"), status: "DELETED" });
    const listed = await handler(asCaller("GET /v1/admin/players/duplicates", "admin"));
    expect(JSON.parse(listed.body)).toEqual({
      duplicates: [
        {
          emailKey: "pat@example.com",
          accounts: [
            {
              playerId: "ACCT#old",
              signInProviders: ["GOOGLE"],
              createdAt: "2026-01-01T00:00:00.000Z",
            },
            {
              playerId: "ACCT#new",
              signInProviders: ["GOOGLE"],
              createdAt: "2026-02-01T00:00:00.000Z",
            },
            {
              playerId: "ACCT#third",
              signInProviders: ["GOOGLE"],
              createdAt: "2026-03-01T00:00:00.000Z",
            },
          ],
        },
      ],
    });
    const merge = asCaller("POST /v1/admin/players/merge", "admin") as Record<string, unknown>;
    merge["body"] = JSON.stringify({ primaryPlayerId: "ACCT#old", duplicatePlayerId: "ACCT#new" });
    expect(JSON.parse((await handler(merge)).body)).toEqual({
      primaryPlayerId: "ACCT#old",
      mergedPlayerId: "ACCT#new",
    });
    merge["body"] = JSON.stringify({ primaryPlayerId: "GUEST#x", duplicatePlayerId: "ACCT#new" });
    expect((await handler(merge)).statusCode).toBe(400);
    const operator = await handler({
      operatorTask: "MERGE_ACCOUNTS",
      primaryPlayerId: "ACCT#old",
      duplicatePlayerId: "ACCT#third",
    });
    expect(JSON.parse(operator.body)).toEqual({
      primaryPlayerId: "ACCT#old",
      mergedPlayerId: "ACCT#third",
    });
    const after = await handler(asCaller("GET /v1/admin/players/duplicates", "admin"));
    expect(JSON.parse(after.body)).toEqual({ duplicates: [] });
  });

  it("refuses guests and players with 403", async () => {
    for (const tier of ["guest", "player"] as const)
      for (const route of [
        "GET /v1/admin/deployments",
        "POST /v1/admin/deployments",
        "GET /v1/admin/players/duplicates",
        "POST /v1/admin/players/merge",
      ])
        expect((await handler(asCaller(route, tier))).statusCode).toBe(403);
  });

  it("has a Lambda entry point", async () => {
    vi.stubEnv("AWS_REGION", "us-east-1");
    const { handler: entry } = await import("../../../../src/controller/web-api/admin/handler");
    expect(typeof entry).toBe("function");
    vi.unstubAllEnvs();
  });

  it("serves the day metrics and the day's failures to an admin", async () => {
    await rollups.add("2026-11-21", { counters: { decisions: 3 } }, AT.toISOString());
    const metrics = await handler({
      ...asCaller("GET /v1/admin/metrics", "admin"),
      queryStringParameters: { from: "2026-11-20", to: "2026-11-21" },
    });
    expect(JSON.parse(metrics.body)).toMatchObject({
      days: [{ period: "2026-11-21", decisions: 3, totalPlayers: 0, clientLatencyP50Ms: null }],
    });
    const failures = await handler({
      ...asCaller("GET /v1/admin/decisions", "admin"),
      queryStringParameters: { day: "2026-11-21", class: "HARD" },
    });
    expect(JSON.parse(failures.body)).toEqual({
      decisions: [
        {
          decisionId: "d1",
          createdAt: "2026-11-21T09:00:00.000Z",
          gameId: "spider-solitaire",
          transcript: "deal",
          outcome: "UNRECOGNIZED",
          failureClass: "HARD",
          clientLatencyMs: null,
        },
      ],
    });
    const unclassed = await handler({
      ...asCaller("GET /v1/admin/decisions", "admin"),
      queryStringParameters: { day: "2026-11-21" },
    });
    expect((JSON.parse(unclassed.body) as { decisions: unknown[] }).decisions).toHaveLength(1);
    expect((await handler(asCaller("GET /v1/admin/metrics", "admin"))).statusCode).toBe(400);
    expect((await handler(asCaller("GET /v1/admin/decisions", "player"))).statusCode).toBe(403);
  });
});

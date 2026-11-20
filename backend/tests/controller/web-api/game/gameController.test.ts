import { describe, expect, it, vi } from "vitest";
import { createGameHandler } from "../../../../src/controller/web-api/game/gameController";
import { gameRoutes } from "../../../../src/controller/web-api/game/gameRoutes";
import { createInMemoryGameSessionDao } from "../../../../src/dao/gameSession/inMemoryGameSessionDao";
import { createInMemorySeatAssignmentDao } from "../../../../src/dao/seatAssignment/inMemorySeatAssignmentDao";
import { createBundledRulesRepository } from "../../../../src/game-catalog";
import { createLogger } from "../../../../src/logger";
import { SessionEnvelopeSchema, type SessionEnvelope } from "../../../../src/models/api";
import { createGameSessionService } from "../../../../src/service/gameSession/gameSessionService";
import { apiEvent } from "../apiEvent";

const repository = createBundledRulesRepository();
const write = vi.fn();

function setup() {
  const sessions = createGameSessionService({
    dao: createInMemoryGameSessionDao(),
    seats: createInMemorySeatAssignmentDao(),
    games: (gameId, version) => repository.compiled(gameId, version),
    newSeed: () => "00000000000000000000000000000001",
  });
  return createGameHandler({ catalog: repository, sessions, logger: createLogger({ write }) });
}

const json = (result: { body: string }) => JSON.parse(result.body) as Record<string, unknown>;
const envelopeOf = (result: { body: string }): SessionEnvelope =>
  SessionEnvelopeSchema.parse(JSON.parse(result.body));

describe("game controller", () => {
  it("lists the catalog and finds one game", async () => {
    const handler = setup();
    const list = await handler(apiEvent("GET /v1/games"));
    expect(list.statusCode).toBe(200);
    expect((json(list)["games"] as { gameId: string }[]).map((g) => g.gameId)).toEqual([
      "spider-solitaire",
    ]);
    const one = await handler(
      apiEvent("GET /v1/games/{gameId}", { pathParameters: { gameId: "spider-solitaire" } }),
    );
    expect(json(one)).toMatchObject({ gameId: "spider-solitaire", path: "/spider" });
    const missing = await handler(
      apiEvent("GET /v1/games/{gameId}", { pathParameters: { gameId: "chess" } }),
    );
    expect(missing.statusCode).toBe(404);
  });

  it("plays a session through every session route", async () => {
    const handler = setup();
    const noCurrent = await handler(
      apiEvent("GET /v1/sessions/current", { query: { gameId: "spider-solitaire" } }),
    );
    expect(noCurrent.statusCode).toBe(404);
    expect((await handler(apiEvent("GET /v1/sessions/current"))).statusCode).toBe(400);

    const started = await handler(
      apiEvent("POST /v1/sessions", {
        body: { gameId: "spider-solitaire", options: { suits: 1 } },
      }),
    );
    expect(started.statusCode).toBe(201);
    const envelope = envelopeOf(started);
    const sessionId = envelope.session.sessionId;
    const params = { pathParameters: { sessionId } };

    const current = await handler(
      apiEvent("GET /v1/sessions/current", { query: { gameId: "spider-solitaire" } }),
    );
    expect(envelopeOf(current).session.sessionId).toBe(sessionId);
    expect(
      envelopeOf(await handler(apiEvent("GET /v1/sessions/{sessionId}", params))).session.version,
    ).toBe(0);

    const hint = json(await handler(apiEvent("GET /v1/sessions/{sessionId}/hint", params)));
    expect(typeof hint["text"]).toBe("string");

    const actionId = (envelope.legalActions[0] as { actionId: string }).actionId;
    const moved = await handler(
      apiEvent("POST /v1/sessions/{sessionId}/actions", {
        ...params,
        body: { actionId, expectedVersion: 0, source: "VOICE" },
      }),
    );
    expect(envelopeOf(moved).session.version).toBe(1);

    const stale = await handler(
      apiEvent("POST /v1/sessions/{sessionId}/actions", {
        ...params,
        body: { actionId, expectedVersion: 0, source: "VOICE" },
      }),
    );
    expect(stale.statusCode).toBe(409);
    expect(json(stale)).toMatchObject({
      code: "VERSION_CONFLICT",
      current: { session: { version: 1 } },
    });

    const undone = await handler(
      apiEvent("POST /v1/sessions/{sessionId}/undo", {
        ...params,
        body: { expectedVersion: 1, source: "KEYBOARD" },
      }),
    );
    expect(envelopeOf(undone).session.version).toBe(2);

    const abandoned = await handler(
      apiEvent("POST /v1/sessions/{sessionId}/abandon", {
        ...params,
        body: { expectedVersion: 2 },
      }),
    );
    expect(envelopeOf(abandoned).session.status).toBe("ABANDONED");
  });

  it("refuses bad bodies, unknown games, strangers and unknown routes", async () => {
    const handler = setup();
    expect((await handler(apiEvent("POST /v1/sessions", { body: "not json" }))).statusCode).toBe(
      400,
    );
    expect(
      (await handler(apiEvent("POST /v1/sessions", { body: { gameId: "chess" } }))).statusCode,
    ).toBe(404);
    for (const route of ["actions", "undo", "abandon"]) {
      const result = await handler(
        apiEvent(`POST /v1/sessions/{sessionId}/${route}`, {
          pathParameters: { sessionId: "x" },
          body: {},
        }),
      );
      expect(result.statusCode).toBe(400);
    }
    const started = envelopeOf(
      await handler(apiEvent("POST /v1/sessions", { body: { gameId: "spider-solitaire" } })),
    );
    const stranger = await handler(
      apiEvent("GET /v1/sessions/{sessionId}", {
        identity: "p2",
        pathParameters: { sessionId: started.session.sessionId },
      }),
    );
    expect(stranger.statusCode).toBe(403);
    expect((await handler(apiEvent("GET /v1/sessions", {}))).statusCode).toBe(404);
    expect((await handler({ nope: true })).statusCode).toBe(400);
    expect((await handler(apiEvent("GET /v1/games", { identity: null }))).statusCode).toBe(401);
    expect((await handler({ ...apiEvent("GET /v1/games"), routeKey: undefined })).statusCode).toBe(
      404,
    );
  });

  it("logs and hides unexpected failures", async () => {
    const handler = createGameHandler({
      catalog: { list: () => Promise.reject(new Error("disk on fire")) },
      sessions: {} as never,
      logger: createLogger({ write }),
    });
    const result = await handler(apiEvent("GET /v1/games"));
    expect(result.statusCode).toBe(500);
    expect(json(result)).toEqual({ code: "INTERNAL_ERROR", message: "Something went wrong." });
    expect(write).toHaveBeenCalled();
  });

  it("covers every route in the route list", () => {
    expect(gameRoutes.map((route) => `${route.method} ${route.path}`)).toHaveLength(9);
  });
});

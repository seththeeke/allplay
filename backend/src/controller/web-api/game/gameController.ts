import type { z } from "zod";
import type { Logger } from "../../../logger";
import {
  AbandonRequestSchema,
  ApplyActionRequestSchema,
  GameCatalogEntrySchema,
  StartSessionRequestSchema,
  UndoRequestSchema,
  type GameCatalogEntry,
} from "../../../models/api";
import { invalidRequest, notFound } from "../../../service/gameSession/errors";
import type { GameSessionService } from "../../../service/gameSession/gameSessionService";
import { jsonBody } from "../shared/httpEvent";
import { gameRoutes } from "./gameRoutes";
import { createRouter, type RouteRequest } from "../shared/router";
import type { AndonGate } from "../../../service/andon/andonService";
import type { HttpResult } from "../shared/response";

export interface GameControllerDeps {
  catalog: { list(): Promise<GameCatalogEntry[]> };
  sessions: GameSessionService;
  logger: Logger;
  /** The andon cord check (productionalization.md section 4.3); absent where play is never paused. */
  andon?: AndonGate;
}

/** Parses the request body with a route's schema; a mismatch is a 400 before any service runs. */
function body<T extends z.ZodType>(schema: T, request: RouteRequest): z.output<T> {
  const parsed = schema.safeParse(jsonBody(request.event));
  if (!parsed.success) throw invalidRequest("The request body is not valid.");
  return parsed.data;
}

/** Handler for the game bundle: the catalog and session routes of game-engine.md section 11. */
export function createGameHandler(
  deps: GameControllerDeps,
): (event: unknown) => Promise<HttpResult> {
  const { sessions } = deps;
  const catalog = async () =>
    (await deps.catalog.list()).map((entry) => GameCatalogEntrySchema.parse(entry));
  return createRouter(
    {
      "GET /v1/games": async () => [200, { games: await catalog() }],
      "GET /v1/games/{gameId}": async (request) => {
        const entry = (await catalog()).find((game) => game.gameId === request.param("gameId"));
        if (entry === undefined) throw notFound("Game");
        return [200, entry];
      },
      "POST /v1/sessions": async (request) => [
        201,
        await sessions.start(request.caller.playerId, body(StartSessionRequestSchema, request)),
      ],
      "GET /v1/sessions/current": async (request) => {
        const gameId = request.query("gameId");
        if (gameId === undefined || gameId === "") throw invalidRequest("gameId is required.");
        const current = await sessions.current(request.caller.playerId, gameId);
        if (current === null) throw notFound("Session");
        return [200, current];
      },
      "GET /v1/sessions/{sessionId}": async (request) => [
        200,
        await sessions.get(request.caller.playerId, request.param("sessionId")),
      ],
      "POST /v1/sessions/{sessionId}/actions": async (request) => {
        const input = body(ApplyActionRequestSchema, request);
        return [
          200,
          await sessions.applyAction(request.caller.playerId, request.param("sessionId"), input),
        ];
      },
      "POST /v1/sessions/{sessionId}/undo": async (request) => {
        const input = body(UndoRequestSchema, request);
        return [
          200,
          await sessions.undo(request.caller.playerId, request.param("sessionId"), input),
        ];
      },
      "GET /v1/sessions/{sessionId}/hint": async (request) => [
        200,
        await sessions.hint(request.caller.playerId, request.param("sessionId")),
      ],
      "POST /v1/sessions/{sessionId}/abandon": async (request) => {
        const input = body(AbandonRequestSchema, request);
        return [
          200,
          await sessions.abandon(request.caller.playerId, request.param("sessionId"), input),
        ];
      },
    },
    deps.logger,
    gameRoutes,
    undefined,
    undefined,
    deps.andon === undefined ? undefined : { gate: deps.andon },
  );
}

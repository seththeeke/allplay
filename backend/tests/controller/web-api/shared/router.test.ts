import { describe, expect, it, vi } from "vitest";
import { createRouter } from "../../../../src/controller/web-api/shared/router";
import { devIdentity } from "../../../../src/local/eventAdapter";
import { createLogger } from "../../../../src/logger";
import { GameSessionError } from "../../../../src/service/gameSession/errors";
import { apiEvent } from "../apiEvent";

function asGuest(routeKey: string) {
  const event = apiEvent(routeKey) as { requestContext: Record<string, unknown> };
  event.requestContext["authorizer"] = { iam: devIdentity({ tier: "guest", id: "g-1" }) };
  return event;
}

describe("router andon check", () => {
  const routes = [
    { method: "GET", path: "/v1/play" },
    { method: "GET", path: "/v1/free" },
  ];
  const controllers = {
    "GET /v1/play": () => Promise.resolve<[number, unknown]>([200, { ok: true }]),
    "GET /v1/free": () => Promise.resolve<[number, unknown]>([200, { ok: true }]),
  };
  const logger = createLogger({ write: vi.fn() });

  it("stops every route but the exempt ones while the cord is pulled", async () => {
    let pulled = true;
    const router = createRouter(controllers, logger, routes, undefined, undefined, {
      gate: { isPulled: () => Promise.resolve(pulled) },
      exempt: new Set(["GET /v1/free"]),
    });
    const stopped = await router(asGuest("GET /v1/play"));
    expect(stopped.statusCode).toBe(500);
    expect(JSON.parse(stopped.body)).toEqual({
      code: "ANDON_CORD_PULLED",
      message: "All Play is paused right now. Please try again later.",
    });
    expect((await router(asGuest("GET /v1/free"))).statusCode).toBe(200);
    pulled = false;
    expect((await router(asGuest("GET /v1/play"))).statusCode).toBe(200);
  });

  it("checks every route when no route is exempt", async () => {
    const router = createRouter(controllers, logger, routes, undefined, undefined, {
      gate: { isPulled: () => Promise.resolve(true) },
    });
    expect((await router(asGuest("GET /v1/free"))).statusCode).toBe(500);
  });

  it("adds a session error's details to its body", async () => {
    const router = createRouter(
      {
        "GET /v1/play": () =>
          Promise.reject(
            new GameSessionError(429, "GAME_LIMIT_REACHED", "Come back tomorrow.", undefined, {
              limit: 5,
            }),
          ),
      },
      logger,
      routes,
    );
    const refused = await router(asGuest("GET /v1/play"));
    expect(refused.statusCode).toBe(429);
    expect(JSON.parse(refused.body)).toEqual({
      code: "GAME_LIMIT_REACHED",
      message: "Come back tomorrow.",
      limit: 5,
    });
  });
});

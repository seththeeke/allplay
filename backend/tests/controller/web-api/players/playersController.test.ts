import { describe, expect, it, vi } from "vitest";
import { createPlayersHandler } from "../../../../src/controller/web-api/players/playersController";
import { playersRoutes } from "../../../../src/controller/web-api/players/playersRoutes";
import { createInMemoryPlayerDao } from "../../../../src/dao/player/inMemoryPlayerDao";
import { createInMemoryPreferenceDao } from "../../../../src/dao/preference/inMemoryPreferenceDao";
import { createInMemoryMergeTokenDao } from "../../../../src/dao/mergeToken/inMemoryMergeTokenDao";
import { devIdentity } from "../../../../src/local/eventAdapter";
import { createLogger } from "../../../../src/logger";
import { createMergeService, preferencesStep } from "../../../../src/service/player/mergeService";
import {
  createPlayerService,
  type PlayerService,
} from "../../../../src/service/player/playerService";
import { apiEvent } from "../apiEvent";

const write = vi.fn();
const merge = createMergeService({
  players: createInMemoryPlayerDao(),
  mergeTokens: createInMemoryMergeTokenDao(),
  steps: [],
});

function setup() {
  const players = createInMemoryPlayerDao();
  const preferences = createInMemoryPreferenceDao();
  const service = createPlayerService({ players, preferences });
  const merging = createMergeService({
    players,
    mergeTokens: createInMemoryMergeTokenDao(),
    steps: [preferencesStep(preferences)],
  });
  return {
    players,
    handler: createPlayersHandler({
      players: service,
      merge: merging,
      logger: createLogger({ write }),
    }),
  };
}

/** An event from a caller of the given development tier (authn-authz.md section 11). */
function as(routeKey: string, tier: "guest" | "player", id: string, body?: unknown) {
  const event = apiEvent(routeKey, body === undefined ? {} : { body }) as {
    requestContext: Record<string, unknown>;
  };
  event.requestContext["authorizer"] = { iam: devIdentity({ tier, id }) };
  return event;
}

const json = (result: { body: string }) => JSON.parse(result.body) as Record<string, unknown>;

describe("players controller", () => {
  it("answers me, records the guest, and patches app and game preferences", async () => {
    const { handler, players } = setup();
    const me = await handler(apiEvent("GET /v1/players/me", { identity: "g-1" }));
    expect(json(me)).toEqual({
      playerId: "GUEST#g-1",
      kind: "GUEST",
      tier: "GUEST",
      displayName: null,
      email: null,
    });
    expect(await players.get("GUEST#g-1")).not.toBeNull();
    const app = await handler(
      apiEvent("PATCH /v1/players/me/preferences/{scope}", {
        identity: "g-1",
        pathParameters: { scope: "APP" },
        body: { zoomLevel: 2 },
      }),
    );
    expect(json(app)).toMatchObject({ app: { zoomLevel: 2 } });
    const game = await handler(
      apiEvent("PATCH /v1/players/me/preferences/{scope}", {
        identity: "g-1",
        pathParameters: { scope: "GAME#spider-solitaire" },
        body: { lastOptions: { suits: 2 } },
      }),
    );
    expect(json(game)).toMatchObject({
      games: { "spider-solitaire": { lastOptions: { suits: 2 } } },
    });
    const read = await handler(apiEvent("GET /v1/players/me/preferences", { identity: "g-1" }));
    expect(json(read)).toMatchObject({ app: { zoomLevel: 2 } });
  });

  it("deletes a signed-in account and refuses guests", async () => {
    const { handler } = setup();
    const signedIn = {
      ...apiEvent("DELETE /v1/players/me"),
      requestContext: {
        requestId: "r",
        http: { method: "DELETE", path: "/v1/players/me" },
        authorizer: {
          iam: {
            cognitoIdentity: {
              identityId: "id-1",
              amr: ["authenticated", "x:CognitoSignIn:sub-1"],
            },
            userArn: "arn:aws:sts::1:assumed-role/AllPlay-PlayerRole-Test/x",
          },
        },
      },
    };
    const deleted = await handler(signedIn);
    expect(deleted.statusCode).toBe(200);
    expect(json(deleted)).toEqual({ deleted: true });
    expect((await handler(apiEvent("DELETE /v1/players/me"))).statusCode).toBe(403);
  });

  it("signs out everywhere, revokes Apple before deleting, and handles Apple notifications", async () => {
    const players = createInMemoryPlayerDao();
    const service = createPlayerService({ players, preferences: createInMemoryPreferenceDao() });
    const apple = {
      revokeForDeletion: vi.fn(() => Promise.resolve(true)),
      handleNotification: vi.fn((payload: string) =>
        payload === "bad"
          ? Promise.reject(new Error("bad signature"))
          : Promise.resolve("ACCOUNT_DELETED"),
      ),
    };
    const handler = createPlayersHandler({
      players: service,
      apple,
      merge,
      logger: createLogger({ write }),
    });
    const asPlayer = (routeKey: string, body?: unknown) => {
      const [method, path] = routeKey.split(" ") as [string, string];
      return {
        ...apiEvent(routeKey, body === undefined ? {} : { body }),
        requestContext: {
          requestId: "r",
          http: { method, path },
          authorizer: {
            iam: {
              cognitoIdentity: {
                identityId: "id-1",
                amr: ["authenticated", "x:CognitoSignIn:sub-1"],
              },
              userArn: "arn:aws:sts::1:assumed-role/AllPlay-PlayerRole-Test/x",
            },
          },
        },
      };
    };
    expect(json(await handler(asPlayer("POST /v1/players/me/sign-out")))).toEqual({
      signedOut: true,
    });
    await handler(asPlayer("DELETE /v1/players/me", { appleAuthorizationCode: "code" }));
    expect(apple.revokeForDeletion).toHaveBeenCalledWith("code");
    expect(
      (await handler(asPlayer("DELETE /v1/players/me", { appleAuthorizationCode: 5 }))).statusCode,
    ).toBe(400);
    const notify = (body: unknown) =>
      apiEvent("POST /v1/apple/notifications", { identity: null, body });
    const ok = await handler(notify({ payload: "jwt" }));
    expect(json(ok)).toEqual({ result: "ACCOUNT_DELETED" });
    expect((await handler(notify({ payload: "bad" }))).statusCode).toBe(400);
    expect((await handler(notify({}))).statusCode).toBe(400);
    const withoutApple = createPlayersHandler({
      players: service,
      merge,
      logger: createLogger({ write }),
    });
    expect((await withoutApple(notify({ payload: "jwt" }))).statusCode).toBe(400);
    expect((await withoutApple(asPlayer("DELETE /v1/players/me"))).statusCode).toBe(200);
    expect((await handler({ nope: true })).statusCode).toBe(400);
  });

  it("refuses bad scopes and unknown or invalid fields", async () => {
    const { handler } = setup();
    for (const [scope, body] of [
      ["NOPE", { zoomLevel: 2 }],
      ["APP", { zoomLevel: 9 }],
      ["APP", { playerId: "ACCT#someone" }],
      ["GAME#spider-solitaire", { helpSeen: "yes" }],
    ] as const) {
      const result = await handler(
        apiEvent("PATCH /v1/players/me/preferences/{scope}", { pathParameters: { scope }, body }),
      );
      expect(result.statusCode).toBe(400);
    }
  });

  it("serves the request even when activity cannot be recorded", async () => {
    const failing: PlayerService = {
      ...createPlayerService({
        players: createInMemoryPlayerDao(),
        preferences: createInMemoryPreferenceDao(),
      }),
      recordActivity: () => Promise.reject(new Error("throttled")),
    };
    const handler = createPlayersHandler({
      players: failing,
      merge,
      logger: createLogger({ write }),
    });
    expect((await handler(apiEvent("GET /v1/players/me"))).statusCode).toBe(200);
    expect(write).toHaveBeenCalledWith(
      "WARN",
      expect.stringContaining("Caller activity was not recorded"),
    );
  });

  it("lists its routes for CDK with their tiers", async () => {
    expect(playersRoutes.map((route) => route.minimumTier)).toEqual([
      "GUEST",
      "GUEST",
      "GUEST",
      "PLAYER",
      "PLAYER",
      "GUEST",
      "PLAYER",
    ]);
    const { handler } = await import("../../../../src/controller/web-api/players/handler");
    expect(typeof handler).toBe("function");
  });

  it("issues a guest merge token, and redeems it as the account, moving preferences", async () => {
    const { handler, players } = setup();
    const patched = as("PATCH /v1/players/me/preferences/{scope}", "guest", "g-9", {
      zoomLevel: 2,
    });
    (patched as Record<string, unknown>)["pathParameters"] = { scope: "APP" };
    await handler(patched);
    const issued = await handler(as("POST /v1/players/me/merge-tokens", "guest", "g-9"));
    expect(issued.statusCode).toBe(201);
    const { token } = json(issued) as { token: string };
    expect(
      (await handler(as("POST /v1/players/me/merge", "guest", "g-9", { token }))).statusCode,
    ).toBe(403);
    expect((await handler(as("POST /v1/players/me/merge", "player", "sub-9", {}))).statusCode).toBe(
      400,
    );
    const merged = await handler(as("POST /v1/players/me/merge", "player", "sub-9", { token }));
    expect(json(merged)).toEqual({ primaryPlayerId: "ACCT#sub-9", mergedPlayerId: "GUEST#g-9" });
    const prefs = await handler(as("GET /v1/players/me/preferences", "player", "sub-9"));
    expect(json(prefs)).toMatchObject({ app: { zoomLevel: 2 } });
    expect(await players.get("GUEST#g-9")).toMatchObject({ status: "MERGED" });
    const reused = await handler(as("POST /v1/players/me/merge", "player", "sub-8", { token }));
    expect(reused.statusCode).toBe(422);
  });
});

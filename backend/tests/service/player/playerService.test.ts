import { describe, expect, it } from "vitest";
import { createInMemoryPlayerDao } from "../../../src/dao/player/inMemoryPlayerDao";
import { PlayerExistsError, type PlayerDao } from "../../../src/dao/player/playerDao";
import { createInMemoryPreferenceDao } from "../../../src/dao/preference/inMemoryPreferenceDao";
import { DEFAULT_APP_PREFERENCES, DEFAULT_GAME_PREFERENCES } from "../../../src/models/api";
import { guestTtl } from "../../../src/models/player";
import {
  createDeployedPlayerService,
  createPlayerService,
} from "../../../src/service/player/playerService";
import { createInMemoryGameTables } from "../../../src/dao/gameSession/inMemoryGameSessionDao";
import { createPlayerGameData } from "../../../src/service/gameSession/playerGameData";
import { createGameAllowanceService } from "../../../src/service/player/gameAllowance";

/** Sessions, seats and stats over fresh in-memory tables. */
const memoryGameData = () => createPlayerGameData(createInMemoryGameTables());

const guest = { playerId: "GUEST#id-1", tier: "GUEST" as const, identityId: "id-1" };
const account = { playerId: "ACCT#sub-1", tier: "PLAYER" as const, identityId: "id-2" };

function setup(start = Date.parse("2026-11-21T12:00:00.000Z")) {
  let clock = start;
  const players = createInMemoryPlayerDao();
  const preferences = createInMemoryPreferenceDao();
  const service = createPlayerService({
    players,
    preferences,
    gameData: memoryGameData(),
    now: () => new Date(clock),
  });
  return {
    service,
    players,
    preferences,
    advance: (ms: number) => (clock += ms),
    now: () => new Date(clock),
  };
}

describe("player service", () => {
  it("reports the caller's games left, for guests and accounts", async () => {
    const players = createInMemoryPlayerDao();
    const allowance = createGameAllowanceService({
      players,
      defaultLimit: { count: 5, period: "DAY" },
      now: () => new Date("2026-11-21T12:00:00.000Z"),
    });
    const service = createPlayerService({
      players,
      preferences: createInMemoryPreferenceDao(),
      gameData: memoryGameData(),
      allowance,
    });
    await allowance.consume(guest.playerId);
    expect((await service.me(guest)).gameAllowance).toEqual({
      limit: 5,
      period: "DAY",
      used: 1,
      resetsAt: "2026-11-22T00:00:00.000Z",
    });
    expect((await service.me(account)).gameAllowance).toMatchObject({ used: 0 });
    expect(
      createDeployedPlayerService({ PLAYERS_TABLE: "t", DEFAULT_GAME_LIMIT: "5/DAY" }),
    ).toHaveProperty("me");
  });

  it("creates a guest on first activity and refreshes it at most hourly with a 90-day ttl", async () => {
    const t = setup();
    await t.service.recordActivity(guest);
    const created = await t.players.get("GUEST#id-1");
    expect(created).toMatchObject({ kind: "GUEST", identityIds: ["id-1"], ttl: guestTtl(t.now()) });
    t.advance(10 * 60 * 1000);
    await t.service.recordActivity(guest);
    expect((await t.players.get("GUEST#id-1"))?.lastActiveAt).toBe(created?.lastActiveAt);
    t.advance(60 * 60 * 1000);
    await t.service.recordActivity(guest);
    expect((await t.players.get("GUEST#id-1"))?.ttl).toBe(guestTtl(t.now()));
  });

  it("never creates accounts from activity, and tolerates a racing guest create", async () => {
    const t = setup();
    await t.service.recordActivity(account);
    expect(await t.players.get("ACCT#sub-1")).toBeNull();
    const racing: PlayerDao = {
      ...t.players,
      create: (player) => Promise.reject(new PlayerExistsError(player.playerId)),
    };
    const service = createPlayerService({
      players: racing,
      preferences: t.preferences,
      gameData: memoryGameData(),
    });
    await expect(service.recordActivity(guest)).resolves.toBeUndefined();
    const failing: PlayerDao = { ...t.players, create: () => Promise.reject(new Error("down")) };
    await expect(
      createPlayerService({
        players: failing,
        preferences: t.preferences,
        gameData: memoryGameData(),
      }).recordActivity({
        ...guest,
        playerId: "GUEST#x",
      }),
    ).rejects.toThrow("down");
  });

  it("describes the caller, with the account's stored email and name", async () => {
    const t = setup();
    expect(await t.service.me(guest)).toEqual({
      playerId: "GUEST#id-1",
      kind: "GUEST",
      tier: "GUEST",
      displayName: null,
      email: null,
    });
    expect((await t.service.me(account)).email).toBeNull();
    await t.players.create({
      playerId: "ACCT#sub-1",
      kind: "ACCOUNT",
      status: "ACTIVE",
      identityIds: [],
      email: "pat@example.com",
      displayName: "Pat",
      firstSeenAt: "2026-11-21T00:00:00.000Z",
      lastActiveAt: "2026-11-21T00:00:00.000Z",
      entityVersion: 1,
      createdAt: "2026-11-21T00:00:00.000Z",
      updatedAt: "2026-11-21T00:00:00.000Z",
    });
    expect(await t.service.me({ ...account, tier: "ADMIN" })).toMatchObject({
      kind: "ACCOUNT",
      tier: "ADMIN",
      email: "pat@example.com",
      displayName: "Pat",
    });
  });

  it("layers stored preferences over the defaults, with a ttl only for guests", async () => {
    const t = setup();
    expect(await t.service.preferences("GUEST#id-1")).toEqual({
      app: DEFAULT_APP_PREFERENCES,
      games: {},
    });
    const app = await t.service.patchApp(guest, { zoomLevel: 2, theme: "DARK" });
    expect(app.app).toEqual({ ...DEFAULT_APP_PREFERENCES, zoomLevel: 2, theme: "DARK" });
    const game = await t.service.patchGame(guest, "spider-solitaire", { helpSeen: true });
    expect(game.games["spider-solitaire"]).toEqual({ ...DEFAULT_GAME_PREFERENCES, helpSeen: true });
    expect(
      (await t.preferences.list("GUEST#id-1")).every((item) => item.ttl === guestTtl(t.now())),
    ).toBe(true);
    await t.service.patchApp(account, { autoConfirm: true });
    expect((await t.preferences.list("ACCT#sub-1"))[0]?.ttl).toBeUndefined();
  });

  it("builds the deployed service from the environment", () => {
    expect(typeof createDeployedPlayerService({}).me).toBe("function");
    expect(
      typeof createDeployedPlayerService({ PLAYERS_TABLE: "p", PREFERENCES_TABLE: "q" }).me,
    ).toBe("function");
  });
});

describe("account deletion", () => {
  it("deletes preferences, tombstones the player, and deletes the Cognito user", async () => {
    const t = setup();
    const deleted: string[] = [];
    const service = createPlayerService({
      players: t.players,
      preferences: t.preferences,
      gameData: memoryGameData(),
      userPool: {
        id: "pool",
        identities: {
          emailInUse: () => Promise.resolve(false),
          linkTarget: () => Promise.resolve(null),
          link: () => Promise.resolve(),
          addToGroup: () => Promise.resolve(),
          deleteUserBySub: (_pool, sub) => {
            deleted.push(sub);
            return Promise.resolve();
          },
          signOutBySub: (_pool, sub) => {
            deleted.push(`signout ${sub}`);
            return Promise.resolve();
          },
          playerIdForApple: () => Promise.resolve(null),
          mergeUsers: () => Promise.resolve([]),
          invite: () => Promise.resolve(true),
        },
      },
      now: t.now,
    });
    await t.players.create({
      playerId: "ACCT#sub-1",
      kind: "ACCOUNT",
      status: "ACTIVE",
      identityIds: ["id-2"],
      cognitoSub: "sub-1",
      email: "pat@example.com",
      emailKey: "pat@example.com",
      displayName: "Pat",
      signInProviders: ["GOOGLE"],
      firstSeenAt: "2026-11-21T00:00:00.000Z",
      lastActiveAt: "2026-11-21T00:00:00.000Z",
      entityVersion: 1,
      createdAt: "2026-11-21T00:00:00.000Z",
      updatedAt: "2026-11-21T00:00:00.000Z",
    });
    await service.patchApp(account, { zoomLevel: 2 });
    await service.deleteAccount(account);
    expect(await t.preferences.list("ACCT#sub-1")).toEqual([]);
    const tombstone = await t.players.get("ACCT#sub-1");
    expect(tombstone).toMatchObject({ status: "DELETED", identityIds: [] });
    expect(tombstone?.email).toBeUndefined();
    expect(tombstone?.displayName).toBeUndefined();
    expect(deleted).toEqual(["sub-1"]);
    await service.signOut(account);
    expect(deleted).toEqual(["sub-1", "signout sub-1"]);
    await t.service.signOut(account);
    await t.service.deleteAccount({ ...account, playerId: "ACCT#never" });
    expect(await t.players.get("ACCT#never")).toBeNull();
  });
});

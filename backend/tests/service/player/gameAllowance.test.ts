import { describe, expect, it } from "vitest";
import { createInMemoryPlayerDao } from "../../../src/dao/player/inMemoryPlayerDao";
import { GameSessionError } from "../../../src/service/gameSession/errors";
import {
  createGameAllowanceService,
  parseGameLimit,
  windowOf,
} from "../../../src/service/player/gameAllowance";
import { gamesLeftText, limitMessage, outOfGamesText } from "../../../src/models/api";
import { account } from "../../dao/player/playerDaoContract";

/* Friday 2026-11-27, 18:30 UTC. */
const AT = new Date("2026-11-27T18:30:00.000Z");

describe("game limits", () => {
  it("reads a stage's default limit", () => {
    expect(parseGameLimit("5/DAY")).toEqual({ count: 5, period: "DAY" });
    expect(parseGameLimit("12/WEEK")).toEqual({ count: 12, period: "WEEK" });
    expect(parseGameLimit("UNLIMITED")).toEqual({ unlimited: true });
    expect(parseGameLimit(undefined)).toEqual({ unlimited: true });
    expect(parseGameLimit("5/YEAR")).toEqual({ unlimited: true });
  });

  it("finds the UTC day, Monday week and month, and when each ends", () => {
    expect(windowOf("DAY", AT)).toEqual({
      windowStart: "2026-11-27",
      resetsAt: "2026-11-28T00:00:00.000Z",
    });
    expect(windowOf("WEEK", AT)).toEqual({
      windowStart: "2026-11-23",
      resetsAt: "2026-11-30T00:00:00.000Z",
    });
    expect(windowOf("WEEK", new Date("2026-11-29T23:00:00.000Z")).windowStart).toBe("2026-11-23");
    expect(windowOf("MONTH", AT)).toEqual({
      windowStart: "2026-11-01",
      resetsAt: "2026-12-01T00:00:00.000Z",
    });
  });

  it("says how many games were played and when to come back", () => {
    expect(limitMessage(5, "DAY")).toBe("You have played your 5 games today. Come back tomorrow.");
    expect(limitMessage(1, "WEEK")).toBe(
      "You have played your 1 game this week. Come back next week.",
    );
    expect(limitMessage(20, "MONTH")).toContain("this month. Come back next month.");
  });

  it("words the games left and the limit reached for the clients", () => {
    const allowance = { limit: 5, period: "DAY" as const, used: 2, resetsAt: null };
    expect(gamesLeftText(allowance)).toBe("3 of 5 games left today");
    expect(gamesLeftText({ ...allowance, limit: 1, used: 3, period: "WEEK" })).toBe(
      "0 of 1 game left this week",
    );
    expect(gamesLeftText({ limit: null, period: null, used: 4, resetsAt: null })).toBeNull();
    expect(gamesLeftText(undefined)).toBeNull();
    expect(outOfGamesText(allowance)).toBeNull();
    expect(outOfGamesText({ ...allowance, used: 5 })).toBe(
      "You have played your 5 games today. Come back tomorrow.",
    );
    expect(outOfGamesText(undefined)).toBeNull();
    expect(outOfGamesText({ limit: null, period: null, used: 9, resetsAt: null })).toBeNull();
  });

  it("counts starts up to the default, refuses with the reset time, and gives a game back", async () => {
    const players = createInMemoryPlayerDao();
    const service = createGameAllowanceService({
      players,
      defaultLimit: { count: 2, period: "DAY" },
      now: () => AT,
    });
    expect(service.allowance(null)).toEqual({
      limit: 2,
      period: "DAY",
      used: 0,
      resetsAt: "2026-11-28T00:00:00.000Z",
    });
    const window = await service.consume("GUEST#g-1");
    expect(window).toEqual({ period: "DAY", windowStart: "2026-11-27" });
    await service.consume("GUEST#g-1");
    const refused = await service.consume("GUEST#g-1").catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(GameSessionError);
    expect(refused).toMatchObject({
      status: 429,
      code: "GAME_LIMIT_REACHED",
      message: "You have played your 2 games today. Come back tomorrow.",
      details: { limit: 2, period: "DAY", resetsAt: "2026-11-28T00:00:00.000Z" },
    });
    const guest = await players.get("GUEST#g-1");
    expect(guest).toMatchObject({ kind: "GUEST", identityIds: ["g-1"] });
    expect(service.allowance(guest)).toMatchObject({ used: 2 });
    await service.giveBack("GUEST#g-1", window);
    expect(service.allowance(await players.get("GUEST#g-1"))).toMatchObject({ used: 1 });
  });

  it("lets a player's own limit replace the default, and counts an unlimited player by the day", async () => {
    const players = createInMemoryPlayerDao();
    await players.create({
      ...account("ACCT#owner", "o@example.com"),
      gameLimit: { unlimited: true },
    });
    const service = createGameAllowanceService({
      players,
      defaultLimit: { count: 0, period: "DAY" },
      now: () => AT,
    });
    for (let game = 0; game < 7; game += 1) await service.consume("ACCT#owner");
    const owner = await players.get("ACCT#owner");
    expect(service.allowance(owner)).toEqual({
      limit: null,
      period: null,
      used: 7,
      resetsAt: null,
    });
    await expect(service.consume("ACCT#other")).rejects.toMatchObject({
      code: "GAME_LIMIT_REACHED",
    });
    expect(await players.get("ACCT#other")).toBeNull();
    /* A count from an earlier window does not count against today. */
    expect(
      service.allowance({
        ...account("ACCT#x", "x@example.com"),
        gamesPlayed: { period: "DAY", windowStart: "2026-11-26", count: 9 },
      }),
    ).toMatchObject({ used: 0 });
    expect(
      createGameAllowanceService({ players, defaultLimit: { unlimited: true } }).allowance(null),
    ).toMatchObject({ limit: null });
  });
});

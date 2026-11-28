import { describe, expect, it } from "vitest";
import { createInMemoryGameTables } from "../../../src/dao/gameSession/inMemoryGameSessionDao";
import {
  SessionVersionConflictError,
  type GameSessionDao,
} from "../../../src/dao/gameSession/gameSessionDao";
import { StatsVersionConflictError } from "../../../src/dao/playerStats/playerStatsDao";
import { createBundledRulesRepository } from "../../../src/game-catalog";
import { compileRules } from "../../../src/game-engine";
import { toyRules } from "../../game-engine/toyRules";
import { SessionEnvelopeSchema } from "../../../src/models/api";
import { GameSessionError } from "../../../src/service/gameSession/errors";
import { createInMemoryPlayerDao } from "../../../src/dao/player/inMemoryPlayerDao";
import { createGameAllowanceService } from "../../../src/service/player/gameAllowance";
import {
  createGameSessionService,
  variantKeyOf,
} from "../../../src/service/gameSession/gameSessionService";

const repository = createBundledRulesRepository();
const games = (gameId: string, version?: number) => repository.compiled(gameId, version);
const PLAYER = "GUEST#p1";

function setup(wrap: (dao: GameSessionDao) => GameSessionDao = (dao) => dao) {
  const tables = createInMemoryGameTables();
  const dao = wrap(tables.dao);
  const service = createGameSessionService({
    ...tables,
    dao,
    games,
    newSeed: () => "00000000000000000000000000000001",
  });
  return { service, dao, tables };
}

describe("game session service", () => {
  it("counts each start against the limit, keeps the game in progress when refused, and gives back a failed start", async () => {
    const players = createInMemoryPlayerDao();
    const tables = createInMemoryGameTables();
    const allowance = createGameAllowanceService({
      players,
      defaultLimit: { count: 2, period: "DAY" },
    });
    const service = createGameSessionService({ ...tables, games, allowance });
    await service.start(PLAYER, { gameId: "spider-solitaire" });
    const second = await service.start(PLAYER, { gameId: "spider-solitaire" });
    await expect(service.start(PLAYER, { gameId: "spider-solitaire" })).rejects.toMatchObject({
      status: 429,
      code: "GAME_LIMIT_REACHED",
    });
    expect((await service.current(PLAYER, "spider-solitaire"))?.session.sessionId).toBe(
      second.session.sessionId,
    );
    const failing = createGameSessionService({
      ...tables,
      dao: { ...tables.dao, create: () => Promise.reject(new Error("write failed")) },
      games,
      allowance,
    });
    await expect(failing.start("GUEST#p2", { gameId: "spider-solitaire" })).rejects.toThrow(
      "write failed",
    );
    expect((await players.get("GUEST#p2"))?.gamesPlayed?.count).toBe(0);
  });

  it("starts a session with defaults and a ULID, and reads it back", async () => {
    const { service, dao } = setup();
    const envelope = SessionEnvelopeSchema.parse(
      await service.start(PLAYER, { gameId: "spider-solitaire" }),
    );
    expect(envelope.session).toMatchObject({
      status: "IN_PROGRESS",
      version: 0,
      options: { suits: 1, dealStyle: "MICROSOFT" },
    });
    expect(envelope.session.sessionId).toMatch(/^[0-9A-Z]{26}$/);
    expect(envelope.metaActions).toEqual([
      { id: "UNDO", available: false },
      { id: "HINT", available: true },
    ]);
    const stored = await dao.get(envelope.session.sessionId);
    expect(stored).toMatchObject({
      variantKey: "dealStyle=MICROSOFT;suits=1",
      rulesSource: "CORE",
      seats: [{ seatId: "S1", playerId: PLAYER }],
    });
    expect(JSON.stringify(envelope)).not.toContain(stored?.state.seed);
    expect(await service.get(PLAYER, envelope.session.sessionId)).toEqual({
      ...envelope,
      events: [],
    });
  });

  it("uses a random seed and the clock when none are injected", async () => {
    const service = createGameSessionService({
      ...createInMemoryGameTables(),
      games,
    });
    const a = await service.start(PLAYER, { gameId: "spider-solitaire" });
    const b = await service.start(PLAYER, { gameId: "spider-solitaire" });
    expect(a.session.sessionId).not.toBe(b.session.sessionId);
  });

  it("maps unknown games, bad options, missing sessions and other players to API errors", async () => {
    const { service } = setup();
    await expect(service.start(PLAYER, { gameId: "chess" })).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
    await expect(
      service.start(PLAYER, { gameId: "spider-solitaire", options: { suits: 3 } }),
    ).rejects.toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR",
    });
    await expect(service.get(PLAYER, "missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
    const { session } = await service.start(PLAYER, { gameId: "spider-solitaire" });
    await expect(service.get("GUEST#other", session.sessionId)).rejects.toMatchObject({
      status: 403,
      code: "NOT_SEATED",
    });
  });

  it("rejects illegal actions and an undo with nothing to undo", async () => {
    const { service } = setup();
    const { session } = await service.start(PLAYER, { gameId: "spider-solitaire" });
    await expect(
      service.applyAction(PLAYER, session.sessionId, {
        actionId: "MOVE_UNIT|from=tableau.1|depth=9|to=tableau.2",
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ status: 422, code: "ILLEGAL_ACTION" });
    await expect(
      service.undo(PLAYER, session.sessionId, { expectedVersion: 0 }),
    ).rejects.toMatchObject({ code: "ILLEGAL_ACTION" });
  });

  it("gives a hint with its text", async () => {
    const { service } = setup();
    const { session } = await service.start(PLAYER, { gameId: "spider-solitaire" });
    const hint = await service.hint(PLAYER, session.sessionId);
    expect(hint.action?.text).toBe(hint.text);
  });

  it("answers a lost write race with the current envelope", async () => {
    let raced = false;
    const { service } = setup((inner) => ({
      ...inner,
      update: async (session, expected) => {
        if (!raced) {
          raced = true;
          await inner.update({ ...session, summary: { raced: 1 } }, expected);
          throw new SessionVersionConflictError(session.sessionId);
        }
        return inner.update(session, expected);
      },
    }));
    const { session } = await service.start(PLAYER, { gameId: "spider-solitaire" });
    const attempt = service.applyAction(PLAYER, session.sessionId, {
      actionId: "DEAL_ROW",
      expectedVersion: 0,
    });
    await expect(attempt).rejects.toBeInstanceOf(GameSessionError);
    await expect(attempt).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      current: { session: { summary: { raced: 1 } } },
    });
  });

  it("passes through unexpected failures", async () => {
    const { service } = setup((inner) => ({
      ...inner,
      update: () => Promise.reject(new Error("disk on fire")),
    }));
    const { session } = await service.start(PLAYER, { gameId: "spider-solitaire" });
    await expect(
      service.applyAction(PLAYER, session.sessionId, { actionId: "DEAL_ROW", expectedVersion: 0 }),
    ).rejects.toThrow("disk on fire");
    const exploding = createGameSessionService({
      ...createInMemoryGameTables(),
      games: () => {
        throw new Error("catalog down");
      },
    });
    await expect(exploding.start(PLAYER, { gameId: "spider-solitaire" })).rejects.toThrow(
      "catalog down",
    );
  });

  it("ends a session the engine marks lost as abandoned, and offers no hint after", async () => {
    const toy = compileRules(toyRules());
    const service = createGameSessionService({
      ...createInMemoryGameTables(),
      games: () => toy,
      newSeed: () => "00000000000000000000000000000001",
    });
    const { session } = await service.start(PLAYER, {
      gameId: "toy-game",
      options: { mode: "HARD" },
    });
    await service.applyAction(PLAYER, session.sessionId, { actionId: "PEEK", expectedVersion: 0 });
    const lost = await service.applyAction(PLAYER, session.sessionId, {
      actionId: "PEEK",
      expectedVersion: 1,
    });
    expect(lost.session.status).toBe("ABANDONED");
    expect(lost.view.status.status).toBe("LOST");
    expect(await service.hint(PLAYER, session.sessionId)).toMatchObject({ action: null });
  });

  it("sorts option names into the variant key", () => {
    expect(variantKeyOf({ suits: 4, dealStyle: "HOYLE" })).toBe("dealStyle=HOYLE;suits=4");
  });
});

describe("game session service seats", () => {
  it("resumes the current game and abandons it when a new one starts", async () => {
    const { service } = setup();
    expect(await service.current(PLAYER, "spider-solitaire")).toBeNull();
    const first = await service.start(PLAYER, { gameId: "spider-solitaire" });
    expect((await service.current(PLAYER, "spider-solitaire"))?.session.sessionId).toBe(
      first.session.sessionId,
    );
    const second = await service.start(PLAYER, { gameId: "spider-solitaire" });
    expect((await service.get(PLAYER, first.session.sessionId)).session.status).toBe("ABANDONED");
    expect((await service.current(PLAYER, "spider-solitaire"))?.session.sessionId).toBe(
      second.session.sessionId,
    );
    await service.abandon(PLAYER, second.session.sessionId, { expectedVersion: 0 });
    expect(await service.current(PLAYER, "spider-solitaire")).toBeNull();
    const third = await service.start(PLAYER, { gameId: "spider-solitaire" });
    expect(third.session.status).toBe("IN_PROGRESS");
  });
});

describe("session results and retention", () => {
  const KEY = "spider-solitaire#dealStyle=MICROSOFT;suits=1";
  const NOW = new Date("2026-11-22T10:00:00.000Z");

  function tablesService(wrap: (dao: GameSessionDao) => GameSessionDao = (dao) => dao) {
    const tables = createInMemoryGameTables();
    const service = createGameSessionService({
      ...tables,
      dao: wrap(tables.dao),
      games,
      now: () => NOW,
      newSeed: () => "00000000000000000000000000000001",
    });
    return { service, ...tables };
  }

  it("gives guest sessions, seats and stats a ttl, and account ones none", async () => {
    const { service, dao, seats, stats } = tablesService();
    const guest = await service.start(PLAYER, { gameId: "spider-solitaire" });
    const account = await service.start("ACCT#a1", { gameId: "spider-solitaire" });
    const ttl = Math.floor(NOW.getTime() / 1000) + 90 * 24 * 60 * 60;
    expect((await dao.get(guest.session.sessionId))?.ttl).toBe(ttl);
    expect((await seats.get(PLAYER, guest.session.sessionId))?.ttl).toBe(ttl);
    expect((await dao.get(account.session.sessionId))?.ttl).toBeUndefined();
    expect((await seats.get("ACCT#a1", account.session.sessionId))?.ttl).toBeUndefined();
    for (const [playerId, envelope] of [
      [PLAYER, guest],
      ["ACCT#a1", account],
    ] as const) {
      const moved = await service.applyAction(playerId, envelope.session.sessionId, {
        actionId: "DEAL_ROW",
        expectedVersion: 0,
      });
      await service.abandon(playerId, envelope.session.sessionId, {
        expectedVersion: moved.session.version,
      });
    }
    expect((await stats.get(PLAYER, KEY))?.ttl).toBe(ttl);
    expect((await stats.get("ACCT#a1", KEY))?.ttl).toBeUndefined();
    expect((await seats.get(PLAYER, guest.session.sessionId))?.status).toBe("ABANDONED");
  });

  it("counts a game replaced by a new one as a loss once it has a move, and not before", async () => {
    const { service, stats, seats } = tablesService();
    const first = await service.start(PLAYER, { gameId: "spider-solitaire" });
    const second = await service.start(PLAYER, { gameId: "spider-solitaire" });
    expect(await stats.get(PLAYER, KEY)).toBeNull();
    expect((await seats.get(PLAYER, first.session.sessionId))?.status).toBe("ABANDONED");
    await service.applyAction(PLAYER, second.session.sessionId, {
      actionId: "DEAL_ROW",
      expectedVersion: 0,
    });
    const third = await service.start(PLAYER, { gameId: "spider-solitaire" });
    expect(await stats.get(PLAYER, KEY)).toMatchObject({ gamesPlayed: 1, gamesLost: 1 });
    expect((await service.current(PLAYER, "spider-solitaire"))?.session.sessionId).toBe(
      third.session.sessionId,
    );
  });

  it("retries the end when only the stats changed, up to three times", async () => {
    let conflicts = 1;
    const flaky = tablesService((inner) => ({
      ...inner,
      end: async (end) => {
        if (conflicts > 0) {
          conflicts -= 1;
          throw new StatsVersionConflictError("stats");
        }
        return inner.end(end);
      },
    }));
    const started = await flaky.service.start(PLAYER, { gameId: "spider-solitaire" });
    const moved = await flaky.service.applyAction(PLAYER, started.session.sessionId, {
      actionId: "DEAL_ROW",
      expectedVersion: 0,
    });
    await flaky.service.abandon(PLAYER, started.session.sessionId, {
      expectedVersion: moved.session.version,
    });
    expect((await flaky.stats.get(PLAYER, KEY))?.gamesLost).toBe(1);

    let attempts = 0;
    const stuck = tablesService((inner) => ({
      ...inner,
      end: () => {
        attempts += 1;
        return Promise.reject(new StatsVersionConflictError("stats"));
      },
    }));
    const other = await stuck.service.start(PLAYER, { gameId: "spider-solitaire" });
    await expect(
      stuck.service.abandon(PLAYER, other.session.sessionId, { expectedVersion: 0 }),
    ).rejects.toBeInstanceOf(StatsVersionConflictError);
    expect(attempts).toBe(3);
  });

  it("answers an end that lost the race with the current envelope", async () => {
    const { service } = tablesService((inner) => ({
      ...inner,
      end: () => Promise.reject(new SessionVersionConflictError("s")),
    }));
    const started = await service.start(PLAYER, { gameId: "spider-solitaire" });
    await expect(
      service.abandon(PLAYER, started.session.sessionId, { expectedVersion: 0 }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });
});

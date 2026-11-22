import { expect, it } from "vitest";
import {
  SessionExistsError,
  SessionVersionConflictError,
  type GameSessionDao,
} from "../../../src/dao/gameSession/gameSessionDao";
import {
  StatsVersionConflictError,
  type PlayerStatsDao,
} from "../../../src/dao/playerStats/playerStatsDao";
import type { SeatAssignmentDao } from "../../../src/dao/seatAssignment/seatAssignmentDao";
import { createBundledRulesRepository } from "../../../src/game-catalog";
import type { GameSession } from "../../../src/models/gameSession";
import type { PlayerStats } from "../../../src/models/playerStats";
import type { SeatAssignment } from "../../../src/models/seatAssignment";

const spider = createBundledRulesRepository().compiled("spider-solitaire");
const AT = "2026-11-19T12:00:00.000Z";

export interface GameTables {
  dao: GameSessionDao;
  seats: SeatAssignmentDao;
  stats: PlayerStatsDao;
}

export function sampleSession(
  sessionId = "01JEX4Q8N6W2D3K5T7V9B1C3E5",
  playerId = "GUEST#p1",
): GameSession {
  const state = spider.createGame({
    options: {},
    seed: "00000000000000000000000000000005",
    seats: ["S1"],
  });
  return {
    sessionId,
    gameId: "spider-solitaire",
    rulesSource: "CORE",
    rulesVersion: 1,
    engineSchemaVersion: 1,
    options: state.options,
    variantKey: "dealStyle=MICROSOFT;suits=1",
    seats: [{ seatId: "S1", playerId }],
    status: "IN_PROGRESS",
    version: 0,
    state,
    summary: { ...state.vars },
    startedAt: AT,
    entityVersion: 1,
    createdAt: AT,
    updatedAt: AT,
  };
}

export function sampleSeat(session: GameSession, status = session.status): SeatAssignment {
  const playerId = session.seats[0]?.playerId ?? "";
  return {
    playerId,
    sessionId: session.sessionId,
    gameId: session.gameId,
    seatId: "S1",
    status,
    playerGameKey: `${playerId}|${session.gameId}`,
    statusSortKey: `${status}#${session.sessionId}`,
    entityVersion: 1,
    createdAt: AT,
    updatedAt: AT,
  };
}

export function sampleStats(playerId: string, version = 1): PlayerStats {
  return {
    playerId,
    statsKey: "spider-solitaire#dealStyle=MICROSOFT;suits=1",
    gameId: "spider-solitaire",
    variantKey: "dealStyle=MICROSOFT;suits=1",
    gamesPlayed: version,
    gamesWon: version,
    gamesLost: 0,
    bestScore: 600,
    fastestWinMoves: 120,
    currentWinStreak: version,
    longestWinStreak: version,
    totalMoves: 120 * version,
    lastPlayedAt: AT,
    version,
    entityVersion: 1,
    createdAt: AT,
    updatedAt: AT,
  };
}

/** Retries a read of an eventually consistent index until it holds the expected value. */
async function eventually<T>(read: () => Promise<T>, expected: (value: T) => boolean): Promise<T> {
  let value = await read();
  for (let attempt = 0; attempt < 20 && !expected(value); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    value = await read();
  }
  return value;
}

/**
 * The behavior every GameSessionDao, with its SeatAssignment and PlayerStats
 * DAOs, must have (game-engine.md section 11.1, data-model.md sections 6 to 8).
 */
export function gameSessionDaoContract(
  create: () => GameTables,
  id: (name: string) => string = (name) => name,
): void {
  it("creates a session with its seats, reads it back exactly, and refuses a used id whole", async () => {
    const { dao, seats } = create();
    const session = sampleSession(id("create"), `GUEST#${id("p-create")}`);
    await dao.create(session, [sampleSeat(session)]);
    expect(await dao.get(session.sessionId)).toEqual(session);
    expect(await seats.get(`GUEST#${id("p-create")}`, session.sessionId)).toEqual(
      sampleSeat(session),
    );
    const other = sampleSession(session.sessionId, `GUEST#${id("p-other")}`);
    await expect(dao.create(other, [sampleSeat(other)])).rejects.toBeInstanceOf(SessionExistsError);
    expect(await seats.get(`GUEST#${id("p-other")}`, session.sessionId)).toBeNull();
  });

  it("returns null for an unknown session", async () => {
    expect(await create().dao.get(id("missing"))).toBeNull();
  });

  it("updates only at the expected version", async () => {
    const { dao } = create();
    const session = sampleSession(id("update"));
    await dao.create(session, []);
    const next = { ...session, version: 1, summary: { score: 499 } };
    await dao.update(next, 0);
    expect(await dao.get(session.sessionId)).toMatchObject({ version: 1, summary: { score: 499 } });
    await expect(dao.update({ ...next, version: 2 }, 0)).rejects.toBeInstanceOf(
      SessionVersionConflictError,
    );
    await expect(
      dao.update({ ...sampleSession(id("never-created")), version: 1 }, 0),
    ).rejects.toBeInstanceOf(SessionVersionConflictError);
  });

  it("ends a session with its seats and stats, once", async () => {
    const { dao, seats, stats } = create();
    const player = `GUEST#${id("p-end")}`;
    const session = sampleSession(id("end"), player);
    await dao.create(session, [sampleSeat(session)]);
    const ended = { ...session, status: "WON" as const, version: 1, endedAt: AT };
    const end = {
      session: ended,
      expectedVersion: 0,
      seats: [sampleSeat(ended)],
      stats: [{ item: sampleStats(player), expectedVersion: null }],
    };
    await dao.end(end);
    expect(await dao.get(session.sessionId)).toMatchObject({ status: "WON", version: 1 });
    expect((await seats.get(player, session.sessionId))?.status).toBe("WON");
    expect(await stats.get(player, sampleStats(player).statsKey)).toEqual(sampleStats(player));
    /* The session is no longer in progress, so the same end is refused and counts nothing again. */
    await expect(
      dao.end({
        ...end,
        expectedVersion: 1,
        stats: [{ item: sampleStats(player, 2), expectedVersion: 1 }],
      }),
    ).rejects.toBeInstanceOf(SessionVersionConflictError);
    expect((await stats.get(player, sampleStats(player).statsKey))?.version).toBe(1);
  });

  it("refuses an end at a stale version or with stale stats, writing nothing", async () => {
    const { dao, seats, stats } = create();
    const player = `GUEST#${id("p-stale")}`;
    const session = sampleSession(id("stale"), player);
    await dao.create(session, [sampleSeat(session)]);
    const ended = { ...session, status: "ABANDONED" as const, version: 1 };
    const fresh = { item: sampleStats(player), expectedVersion: null };
    await expect(
      dao.end({ session: ended, expectedVersion: 5, seats: [sampleSeat(ended)], stats: [fresh] }),
    ).rejects.toBeInstanceOf(SessionVersionConflictError);
    await expect(
      dao.end({
        session: ended,
        expectedVersion: 0,
        seats: [sampleSeat(ended)],
        stats: [{ item: sampleStats(player, 3), expectedVersion: 2 }],
      }),
    ).rejects.toBeInstanceOf(StatsVersionConflictError);
    expect((await dao.get(session.sessionId))?.status).toBe("IN_PROGRESS");
    expect((await seats.get(player, session.sessionId))?.status).toBe("IN_PROGRESS");
    expect(await stats.get(player, fresh.item.statsKey)).toBeNull();
  });

  it("finds the in-progress seat, lists seats newest first, and deletes", async () => {
    const { dao, seats } = create();
    const player = `GUEST#${id("p-seats")}`;
    const older = sampleSession(id("seats-1"), player);
    const newer = sampleSession(id("seats-2"), player);
    await dao.create(older, [sampleSeat(older, "ABANDONED")]);
    await dao.create(newer, [sampleSeat(newer)]);
    const current = await eventually(
      () => seats.currentFor(player, "spider-solitaire"),
      (seat) => seat !== null,
    );
    expect(current?.sessionId).toBe(newer.sessionId);
    expect(await seats.currentFor(player, "another-game")).toBeNull();
    expect((await seats.list(player)).map((seat) => seat.sessionId)).toEqual([
      newer.sessionId,
      older.sessionId,
    ]);
    await seats.put({
      ...sampleSeat(newer),
      status: "WON",
      statusSortKey: `WON#${newer.sessionId}`,
    });
    expect((await seats.get(player, newer.sessionId))?.status).toBe("WON");
    await seats.delete(player, older.sessionId);
    await dao.delete(older.sessionId);
    expect(await seats.get(player, older.sessionId)).toBeNull();
    expect(await dao.get(older.sessionId)).toBeNull();
  });

  it("moves stats into another player's item at its version", async () => {
    const { stats, dao } = create();
    const from = `GUEST#${id("p-from")}`;
    const into = `ACCT#${id("p-into")}`;
    const session = sampleSession(id("stats"), from);
    await dao.create(session, []);
    await dao.end({
      session: { ...session, status: "WON", version: 1 },
      expectedVersion: 0,
      seats: [],
      stats: [{ item: sampleStats(from), expectedVersion: null }],
    });
    const key = sampleStats(from).statsKey;
    await stats.moveInto(
      { item: sampleStats(into), expectedVersion: null },
      { playerId: from, statsKey: key },
    );
    expect(await stats.get(from, key)).toBeNull();
    expect(await stats.list(into)).toEqual([sampleStats(into)]);
    await expect(
      stats.moveInto(
        { item: sampleStats(into, 2), expectedVersion: 7 },
        { playerId: from, statsKey: key },
      ),
    ).rejects.toBeInstanceOf(StatsVersionConflictError);
    await stats.delete(into, key);
    expect(await stats.list(into)).toEqual([]);
  });

  it("stores copies, so changing a read or written object changes nothing stored", async () => {
    const { dao } = create();
    const session = sampleSession(id("copies"));
    await dao.create(session, []);
    session.state.vars["score"] = 1;
    const read = await dao.get(session.sessionId);
    if (read === null) throw new Error("missing");
    expect(read.state.vars["score"]).toBe(500);
    read.seats[0] = { seatId: "S1", playerId: "someone-else" };
    expect((await dao.get(session.sessionId))?.seats[0]?.playerId).toBe("GUEST#p1");
  });

  it("rejects items that break their schemas", async () => {
    const { dao } = create();
    await expect(
      dao.create({ ...sampleSession(id("bad")), status: "PAUSED" } as unknown as GameSession, []),
    ).rejects.toThrow();
    const session = sampleSession(id("bad-seat"));
    await expect(
      dao.create(session, [
        { ...sampleSeat(session), status: "PAUSED" } as unknown as SeatAssignment,
      ]),
    ).rejects.toThrow();
    expect(await dao.get(session.sessionId)).toBeNull();
  });
}

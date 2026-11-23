import { describe, expect, it } from "vitest";
import { createInMemoryConversationMessageDao } from "../../../src/dao/conversationMessage/inMemoryConversationMessageDao";
import { createInMemoryGameTables } from "../../../src/dao/gameSession/inMemoryGameSessionDao";
import { createBundledRulesRepository } from "../../../src/game-catalog";
import { createGameSessionService } from "../../../src/service/gameSession/gameSessionService";
import { createPlayerGameData } from "../../../src/service/gameSession/playerGameData";
import { conversationMessage } from "../../dao/conversationMessage/conversationMessageDaoContract";

const repository = createBundledRulesRepository();
const GUEST = "GUEST#g1";
const ACCOUNT = "ACCT#a1";
const KEY = "spider-solitaire#dealStyle=MICROSOFT;suits=1";

/** A clock the test moves forward, so sessions have an order of play. */
function world() {
  let now = new Date("2026-11-22T10:00:00.000Z");
  const tables = createInMemoryGameTables();
  const conversations = createInMemoryConversationMessageDao();
  const sessions = createGameSessionService({
    ...tables,
    games: (gameId, version) => repository.compiled(gameId, version),
    now: () => now,
    newSeed: () => "00000000000000000000000000000001",
  });
  const tick = () => {
    now = new Date(now.getTime() + 60_000);
    return now;
  };
  return {
    tables,
    conversations,
    sessions,
    data: createPlayerGameData({ ...tables, conversations }),
    tick,
  };
}

async function playOne(w: ReturnType<typeof world>, playerId: string, finish: boolean) {
  w.tick();
  const started = await w.sessions.start(playerId, { gameId: "spider-solitaire" });
  w.tick();
  const moved = await w.sessions.applyAction(playerId, started.session.sessionId, {
    actionId: "DEAL_ROW",
    expectedVersion: 0,
  });
  if (finish)
    await w.sessions.abandon(playerId, started.session.sessionId, {
      expectedVersion: moved.session.version,
    });
  return started.session.sessionId;
}

describe("player game data", () => {
  it("moves a guest's seats, sessions and stats into an account, keeping the newer game in progress", async () => {
    const w = world();
    const finished = await playOne(w, GUEST, true);
    const accountGame = await playOne(w, ACCOUNT, false);
    const guestGame = await playOne(w, GUEST, false);
    const at = w.tick();
    await w.data.moveSeats(GUEST, ACCOUNT, at);
    await w.data.moveStats(GUEST, ACCOUNT, at);
    expect(await w.tables.seats.list(GUEST)).toEqual([]);
    expect(
      (await w.tables.seats.list(ACCOUNT)).map((seat) => [seat.sessionId, seat.status]),
    ).toEqual([
      [guestGame, "IN_PROGRESS"],
      [accountGame, "ABANDONED"],
      [finished, "ABANDONED"],
    ]);
    const moved = await w.tables.dao.get(guestGame);
    expect(moved?.seats).toEqual([{ seatId: "S1", playerId: ACCOUNT }]);
    expect(moved?.ttl).toBeUndefined();
    expect((await w.tables.seats.get(ACCOUNT, guestGame))?.ttl).toBeUndefined();
    /* The displaced account game ended without counting: only the guest's finished game is a loss. */
    expect(await w.data.stats(ACCOUNT)).toMatchObject([{ gamesPlayed: 1, gamesLost: 1 }]);
    expect(await w.data.stats(GUEST)).toEqual([]);
    expect((await w.sessions.current(ACCOUNT, "spider-solitaire"))?.session.sessionId).toBe(
      guestGame,
    );
    /* A retried merge finds nothing left to move. */
    await w.data.moveSeats(GUEST, ACCOUNT, at);
    await w.data.moveStats(GUEST, ACCOUNT, at);
    expect(await w.data.stats(ACCOUNT)).toMatchObject([{ gamesPlayed: 1 }]);
  });

  it("ends the guest's game instead when the account played more recently, and sums stats", async () => {
    const w = world();
    await playOne(w, ACCOUNT, true);
    await playOne(w, GUEST, true);
    const guestGame = await playOne(w, GUEST, false);
    const accountGame = await playOne(w, ACCOUNT, false);
    const at = w.tick();
    await w.data.moveSeats(GUEST, ACCOUNT, at);
    await w.data.moveStats(GUEST, ACCOUNT, at);
    expect((await w.tables.dao.get(guestGame))?.status).toBe("ABANDONED");
    expect((await w.tables.seats.get(ACCOUNT, guestGame))?.status).toBe("ABANDONED");
    expect((await w.sessions.current(ACCOUNT, "spider-solitaire"))?.session.sessionId).toBe(
      accountGame,
    );
    expect(await w.tables.stats.get(ACCOUNT, KEY)).toMatchObject({ gamesPlayed: 2, gamesLost: 2 });
  });

  it("skips a seat whose session is gone, and moves an ended session as is", async () => {
    const w = world();
    const gone = await playOne(w, GUEST, true);
    await w.tables.dao.delete(gone);
    await w.data.moveSeats(GUEST, ACCOUNT, w.tick());
    expect(await w.tables.seats.list(GUEST)).toEqual([]);
    expect(await w.tables.seats.list(ACCOUNT)).toEqual([]);
  });

  it("deletes the player's seats, stats and the sessions they sat in alone", async () => {
    const w = world();
    const mine = await playOne(w, ACCOUNT, true);
    const shared = await playOne(w, ACCOUNT, false);
    const session = await w.tables.dao.get(shared);
    if (session === null) throw new Error("missing");
    await w.tables.dao.update(
      { ...session, seats: [...session.seats, { seatId: "S2", playerId: "ACCT#friend" }] },
      session.version,
    );
    await w.conversations.append(conversationMessage(mine, "01A"));
    await w.conversations.append(conversationMessage(shared, "01B"));
    await w.data.deleteAll(ACCOUNT);
    expect(await w.conversations.list(mine)).toEqual([]);
    expect(await w.conversations.list(shared)).toHaveLength(1);
    expect(await w.tables.dao.get(mine)).toBeNull();
    expect(await w.tables.dao.get(shared)).not.toBeNull();
    expect(await w.tables.seats.list(ACCOUNT)).toEqual([]);
    expect(await w.data.stats(ACCOUNT)).toEqual([]);
  });
});

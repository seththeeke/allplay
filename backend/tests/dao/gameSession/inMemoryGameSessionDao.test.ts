import { describe, expect, it } from "vitest";
import {
  createInMemoryGameSessionDao,
  createInMemoryGameTables,
} from "../../../src/dao/gameSession/inMemoryGameSessionDao";
import { createInMemoryPlayerStatsDao } from "../../../src/dao/playerStats/inMemoryPlayerStatsDao";
import { createInMemorySeatAssignmentDao } from "../../../src/dao/seatAssignment/inMemorySeatAssignmentDao";
import {
  gameSessionDaoContract,
  sampleSession,
  sampleSeat,
  sampleStats,
} from "./gameSessionDaoContract";

describe("in-memory game tables", () => {
  gameSessionDaoContract(createInMemoryGameTables);

  it("each DAO also stands alone with its own store", async () => {
    const dao = createInMemoryGameSessionDao();
    const seats = createInMemorySeatAssignmentDao();
    const stats = createInMemoryPlayerStatsDao();
    const session = sampleSession();
    await dao.create(session, [sampleSeat(session)]);
    expect(await seats.get("GUEST#p1", session.sessionId)).toBeNull();
    await seats.put(sampleSeat(session));
    expect(await seats.list("GUEST#p1")).toHaveLength(1);
    expect(await stats.get("GUEST#p1", sampleStats("GUEST#p1").statsKey)).toBeNull();
  });

  it("orders lists and the current seat when several match", async () => {
    const seats = createInMemorySeatAssignmentDao();
    const stats = createInMemoryPlayerStatsDao();
    const a = sampleSession("01A");
    const b = sampleSession("01B");
    await seats.put(sampleSeat(a));
    await seats.put(sampleSeat(b));
    expect((await seats.currentFor("GUEST#p1", "spider-solitaire"))?.sessionId).toBe("01B");
    await stats.moveInto(
      { item: { ...sampleStats("GUEST#p1"), statsKey: "z" }, expectedVersion: null },
      { playerId: "x", statsKey: "x" },
    );
    await stats.moveInto(
      { item: sampleStats("GUEST#p1"), expectedVersion: null },
      { playerId: "x", statsKey: "x" },
    );
    expect((await stats.list("GUEST#p1")).map((item) => item.statsKey)).toEqual([
      sampleStats("GUEST#p1").statsKey,
      "z",
    ]);
  });
});

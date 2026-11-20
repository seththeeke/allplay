import { describe, expect, it } from "vitest";
import { createInMemorySeatAssignmentDao } from "../../../src/dao/seatAssignment/inMemorySeatAssignmentDao";
import type { SeatAssignment } from "../../../src/models/seatAssignment";

const seat = (sessionId: string, status: SeatAssignment["status"], at: string): SeatAssignment => ({
  playerId: "GUEST#p1",
  sessionId,
  gameId: "spider-solitaire",
  seatId: "S1",
  status,
  lastActionAt: at,
  playerGameKey: "GUEST#p1|spider-solitaire",
  statusSortKey: `${status}#${at}`,
  entityVersion: 1,
  createdAt: at,
  updatedAt: at,
});

describe("in-memory seat assignment DAO", () => {
  it("finds the latest in-progress seat for a player's game and returns copies", async () => {
    const dao = createInMemorySeatAssignmentDao();
    expect(await dao.currentFor("GUEST#p1", "spider-solitaire")).toBeNull();
    await dao.put(seat("s1", "IN_PROGRESS", "2026-11-20T10:00:00.000Z"));
    await dao.put(seat("s2", "IN_PROGRESS", "2026-11-20T11:00:00.000Z"));
    await dao.put(seat("s3", "ABANDONED", "2026-11-20T12:00:00.000Z"));
    expect((await dao.currentFor("GUEST#p1", "spider-solitaire"))?.sessionId).toBe("s2");
    expect(await dao.currentFor("GUEST#p2", "spider-solitaire")).toBeNull();
    const read = await dao.get("GUEST#p1", "s1");
    expect(read?.status).toBe("IN_PROGRESS");
    if (read !== null) read.status = "WON";
    expect((await dao.get("GUEST#p1", "s1"))?.status).toBe("IN_PROGRESS");
    expect(await dao.get("GUEST#p1", "nope")).toBeNull();
  });

  it("rejects items that fail the schema", async () => {
    const dao = createInMemorySeatAssignmentDao();
    await expect(
      dao.put({ ...seat("s1", "IN_PROGRESS", "bad"), lastActionAt: "bad" }),
    ).rejects.toThrow();
  });
});

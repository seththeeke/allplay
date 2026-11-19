import { expect, it } from "vitest";
import {
  SessionExistsError,
  SessionVersionConflictError,
  type GameSessionDao,
} from "../../../src/dao/gameSession/gameSessionDao";
import { createBundledRulesRepository } from "../../../src/game-catalog";
import type { GameSession } from "../../../src/models/gameSession";

const spider = createBundledRulesRepository().compiled("spider-solitaire");

export function sampleSession(sessionId = "01JEX4Q8N6W2D3K5T7V9B1C3E5"): GameSession {
  const state = spider.createGame({
    options: {},
    seed: "00000000000000000000000000000005",
    seats: ["S1"],
  });
  const at = "2026-11-19T12:00:00.000Z";
  return {
    sessionId,
    gameId: "spider-solitaire",
    rulesSource: "CORE",
    rulesVersion: 1,
    engineSchemaVersion: 1,
    options: state.options,
    variantKey: "dealStyle=MICROSOFT;suits=1",
    seats: [{ seatId: "S1", playerId: "GUEST#p1" }],
    status: "IN_PROGRESS",
    version: 0,
    state,
    summary: { ...state.vars },
    startedAt: at,
    entityVersion: 1,
    createdAt: at,
    updatedAt: at,
  };
}

/** The behavior every GameSessionDao must have (game-engine.md section 11.1). */
export function gameSessionDaoContract(create: () => GameSessionDao): void {
  it("creates, reads back exactly, and refuses a duplicate id", async () => {
    const dao = create();
    const session = sampleSession();
    await dao.create(session);
    expect(await dao.get(session.sessionId)).toEqual(session);
    await expect(dao.create(session)).rejects.toBeInstanceOf(SessionExistsError);
  });

  it("returns null for an unknown session", async () => {
    expect(await create().get("missing")).toBeNull();
  });

  it("updates only at the expected version", async () => {
    const dao = create();
    const session = sampleSession();
    await dao.create(session);
    const next = { ...session, version: 1, status: "WON" as const };
    await dao.update(next, 0);
    expect(await dao.get(session.sessionId)).toMatchObject({ version: 1, status: "WON" });
    await expect(dao.update({ ...next, version: 2 }, 0)).rejects.toBeInstanceOf(
      SessionVersionConflictError,
    );
    await expect(dao.update({ ...sampleSession("other"), version: 1 }, 0)).rejects.toBeInstanceOf(
      SessionVersionConflictError,
    );
  });

  it("stores copies, so changing a read or written object changes nothing stored", async () => {
    const dao = create();
    const session = sampleSession();
    await dao.create(session);
    session.state.vars["score"] = 1;
    const read = await dao.get(session.sessionId);
    if (read === null) throw new Error("missing");
    expect(read.state.vars["score"]).toBe(500);
    read.seats[0] = { seatId: "S1", playerId: "someone-else" };
    expect((await dao.get(session.sessionId))?.seats[0]?.playerId).toBe("GUEST#p1");
  });

  it("rejects items that break the GameSession schema", async () => {
    await expect(
      create().create({ ...sampleSession(), status: "PAUSED" } as unknown as GameSession),
    ).rejects.toThrow();
  });
}

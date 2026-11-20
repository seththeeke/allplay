import { describe, expect, it } from "vitest";
import { createInMemoryGameSessionDao } from "../../../src/dao/gameSession/inMemoryGameSessionDao";
import { createInMemorySeatAssignmentDao } from "../../../src/dao/seatAssignment/inMemorySeatAssignmentDao";
import {
  SessionVersionConflictError,
  type GameSessionDao,
} from "../../../src/dao/gameSession/gameSessionDao";
import { createBundledRulesRepository } from "../../../src/game-catalog";
import { compileRules } from "../../../src/game-engine";
import { toyRules } from "../../game-engine/toyRules";
import { SessionEnvelopeSchema } from "../../../src/models/api";
import { GameSessionError } from "../../../src/service/gameSession/errors";
import {
  createGameSessionService,
  variantKeyOf,
} from "../../../src/service/gameSession/gameSessionService";

const repository = createBundledRulesRepository();
const games = (gameId: string, version?: number) => repository.compiled(gameId, version);
const PLAYER = "GUEST#p1";

function setup(dao: GameSessionDao = createInMemoryGameSessionDao()) {
  const service = createGameSessionService({
    dao,
    seats: createInMemorySeatAssignmentDao(),
    games,
    newSeed: () => "00000000000000000000000000000001",
  });
  return { service, dao };
}

describe("game session service", () => {
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
      dao: createInMemoryGameSessionDao(),
      seats: createInMemorySeatAssignmentDao(),
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
    const inner = createInMemoryGameSessionDao();
    let raced = false;
    const racing: GameSessionDao = {
      ...inner,
      update: async (session, expected) => {
        if (!raced) {
          raced = true;
          await inner.update({ ...session, summary: { raced: 1 } }, expected);
          throw new SessionVersionConflictError(session.sessionId);
        }
        return inner.update(session, expected);
      },
    };
    const { service } = setup(racing);
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
    const broken: GameSessionDao = {
      ...createInMemoryGameSessionDao(),
      update: () => Promise.reject(new Error("disk on fire")),
    };
    const { service } = setup(broken);
    const { session } = await service.start(PLAYER, { gameId: "spider-solitaire" });
    await expect(
      service.applyAction(PLAYER, session.sessionId, { actionId: "DEAL_ROW", expectedVersion: 0 }),
    ).rejects.toThrow("disk on fire");
    const exploding = createGameSessionService({
      dao: createInMemoryGameSessionDao(),
      seats: createInMemorySeatAssignmentDao(),
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
      dao: createInMemoryGameSessionDao(),
      seats: createInMemorySeatAssignmentDao(),
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

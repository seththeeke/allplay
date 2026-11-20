import { describe, expect, it } from "vitest";
import { createInMemoryGameSessionDao } from "../../src/dao/gameSession/inMemoryGameSessionDao";
import { createInMemorySeatAssignmentDao } from "../../src/dao/seatAssignment/inMemorySeatAssignmentDao";
import { createBundledRulesRepository } from "../../src/game-catalog";
import { SessionEnvelopeSchema, type SessionEnvelope } from "../../src/models/api";
import { GameSessionError } from "../../src/service/gameSession/errors";
import {
  createGameSessionService,
  type GameSessionService,
} from "../../src/service/gameSession/gameSessionService";
import { readFileSync } from "node:fs";
import { loadScenario, ScenarioSchema, type Scenario } from "./scenarios";

const PLAYER = "GUEST#us-east-1:functional-player";
const repository = createBundledRulesRepository();

/** A session service on the in-memory DAO whose next game deals from the scenario's seed. */
function serviceFor(scenario: Scenario): GameSessionService {
  return createGameSessionService({
    dao: createInMemoryGameSessionDao(),
    seats: createInMemorySeatAssignmentDao(),
    games: (gameId, version) => repository.compiled(gameId, version),
    newSeed: () => scenario.seed,
    now: () => new Date("2026-11-19T12:00:00.000Z"),
  });
}

/** Starts the scenario's game and plays every action through the service, as the HTTP API will. */
async function play(
  scenario: Scenario,
): Promise<{ service: GameSessionService; envelope: SessionEnvelope }> {
  const service = serviceFor(scenario);
  let envelope = await service.start(PLAYER, {
    gameId: "spider-solitaire",
    options: scenario.options,
  });
  for (const actionId of scenario.actions) {
    expect(envelope.legalActions.map((action) => action.actionId)).toContain(actionId);
    envelope = await service.applyAction(PLAYER, envelope.session.sessionId, {
      actionId,
      expectedVersion: envelope.session.version,
    });
    SessionEnvelopeSchema.parse(envelope);
  }
  return { service, envelope };
}

const zone = (envelope: SessionEnvelope, zoneId: string) =>
  envelope.view.zones.find((z) => z.zoneId === zoneId);

describe("Spider Solitaire playthroughs from fixed seeds", () => {
  it("wins a one-suit game by completing all eight runs", async () => {
    const scenario = loadScenario("spider-win-one-suit.json");
    const { envelope } = await play(scenario);
    const moves = scenario.actions.length;
    expect(envelope.session.status).toBe("WON");
    expect(envelope.view.status).toEqual({ status: "WON", blocked: false, canUndo: false });
    expect(envelope.session.summary).toMatchObject({
      completedRuns: 8,
      moveCount: moves,
      undoCount: 0,
      score: 500 - moves + 8 * 100,
    });
    expect(envelope.events.map((event) => event.type)).toContain("GAME_WON");
    expect(envelope.events.find((event) => event.type === "GAME_WON")?.speech).toBe(
      `You won. Final score ${String(500 - moves + 800)}`,
    );
    for (let i = 1; i <= 8; i += 1)
      expect(zone(envelope, `foundation.${String(i)}`)?.count).toBe(13);
    for (let i = 1; i <= 10; i += 1) expect(zone(envelope, `tableau.${String(i)}`)?.count).toBe(0);
    expect(zone(envelope, "stock.1")?.count).toBe(0);
    expect(envelope.legalActions).toEqual([]);
    expect(envelope.metaActions).toEqual([
      { id: "UNDO", available: false },
      { id: "HINT", available: false },
    ]);
  });

  it("refuses moves after the game is won", async () => {
    const { service, envelope } = await play(loadScenario("spider-win-one-suit.json"));
    await expect(
      service.applyAction(PLAYER, envelope.session.sessionId, {
        actionId: "DEAL_ROW",
        expectedVersion: envelope.session.version,
      }),
    ).rejects.toMatchObject({ code: "GAME_OVER", status: 422 });
  });

  it("loses when the player deals the stock early and reaches a dead end, then abandons", async () => {
    const scenario = loadScenario("spider-dead-end.json");
    const { service, envelope } = await play(scenario);
    expect(zone(envelope, "stock.1")?.count).toBe(0);
    expect(envelope.session.status).toBe("IN_PROGRESS");
    expect(envelope.view.status).toEqual({ status: "IN_PROGRESS", blocked: true, canUndo: true });
    expect(envelope.legalActions).toEqual([]);
    expect(envelope.session.summary).toMatchObject({
      completedRuns: 0,
      moveCount: 5,
      score: 495,
      stockDealsRemaining: 0,
    });
    expect(await service.hint(PLAYER, envelope.session.sessionId)).toEqual({
      action: null,
      text: "There are no moves left. Try undo or a new game.",
    });
    const abandoned = await service.abandon(PLAYER, envelope.session.sessionId, {
      expectedVersion: envelope.session.version,
    });
    expect(abandoned.session.status).toBe("ABANDONED");
    expect(abandoned.metaActions.every((meta) => !meta.available)).toBe(true);
    await expect(
      service.undo(PLAYER, envelope.session.sessionId, {
        expectedVersion: abandoned.session.version,
      }),
    ).rejects.toMatchObject({ code: "GAME_OVER" });
  });

  it("escapes the same dead end with undo, paying the undo penalty", async () => {
    const { service, envelope } = await play(loadScenario("spider-dead-end.json"));
    const undone = await service.undo(PLAYER, envelope.session.sessionId, {
      expectedVersion: envelope.session.version,
    });
    expect(undone.view.status.blocked).toBe(false);
    expect(zone(undone, "stock.1")?.count).toBe(10);
    expect(undone.session.summary).toMatchObject({ moveCount: 4, undoCount: 1, score: 495 - 1 });
    expect(undone.legalActions.map((action) => action.actionId)).toContain("DEAL_ROW");
  });

  it("rejects a stale version with the current envelope", async () => {
    const { service, envelope } = await play({
      ...loadScenario("spider-dead-end.json"),
      actions: ["DEAL_ROW"],
    });
    const stale = service.applyAction(PLAYER, envelope.session.sessionId, {
      actionId: "DEAL_ROW",
      expectedVersion: 0,
    });
    await expect(stale).rejects.toBeInstanceOf(GameSessionError);
    await expect(stale).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      current: { session: { version: 1 } },
    });
  });

  for (const [file, suits] of [
    ["spider-two-suits.json", 2],
    ["spider-four-suits.json", 4],
  ] as const) {
    it(`wins a ${String(suits)}-suit game through the service`, async () => {
      const golden = ScenarioSchema.parse(
        JSON.parse(readFileSync(new URL(`../game-engine/golden/${file}`, import.meta.url), "utf8")),
      );
      const { envelope } = await play(golden);
      expect(envelope.session).toMatchObject({
        status: "WON",
        options: { suits },
        summary: { completedRuns: 8, score: 500 - golden.actions.length + 800 },
      });
    });
  }

  it("deals the Hoyle stock in five rows of ten and a last row of four", async () => {
    const scenario: Scenario = {
      name: "Hoyle deal",
      options: { suits: 4, dealStyle: "HOYLE" },
      seed: "00000000000000000000000000000002",
      actions: Array.from({ length: 6 }, () => "DEAL_ROW"),
    };
    const { envelope } = await play(scenario);
    expect(zone(envelope, "stock.1")?.count).toBe(0);
    const counts = Array.from(
      { length: 10 },
      (_, i) => zone(envelope, `tableau.${String(i + 1)}`)?.count,
    );
    expect(counts).toEqual([11, 11, 11, 11, 10, 10, 10, 10, 10, 10]);
  });
});

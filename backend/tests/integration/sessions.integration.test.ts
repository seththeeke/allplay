import { describe, expect, it } from "vitest";
import { createDynamoGameSessionDao } from "../../src/dao/gameSession/dynamoGameSessionDao";
import { createDynamoPlayerStatsDao } from "../../src/dao/playerStats/dynamoPlayerStatsDao";
import { createDynamoSeatAssignmentDao } from "../../src/dao/seatAssignment/dynamoSeatAssignmentDao";
import {
  GameCatalogEntrySchema,
  SessionEnvelopeSchema,
  StatsResponseSchema,
} from "../../src/models/api";
import { apiUrl } from "./apiUrl";
import {
  guestCredentials,
  identityPoolId,
  signedFetch,
  type GuestCredentials,
} from "./guestCredentials";
import { cleanUp, describeWrites } from "./stage";

const url = (path: string) => new URL(path, apiUrl());

/* The catalog reads no table, so both stages check it (game-engine.md section 11). */
describe.runIf(identityPoolId() !== undefined)("game catalog as a guest", () => {
  it("lists Spider Solitaire with its options", async () => {
    const guest = await guestCredentials(identityPoolId() ?? "");
    const response = await signedFetch(url("v1/games"), guest);
    expect(response.status).toBe(200);
    const { games } = (await response.json()) as { games: unknown[] };
    expect(games.map((game) => GameCatalogEntrySchema.parse(game).gameId)).toContain(
      "spider-solitaire",
    );
  });
});

/*
 * A guest's game through the deployed game bundle and its tables
 * (data-model.md sections 6 to 8): start, resume, move, undo, hint, abandon,
 * then the loss in the guest's stats. Test only, since it writes; the
 * guest's items are deleted after the file.
 */
describeWrites("game sessions as a guest", () => {
  let guest: GuestCredentials | undefined;
  cleanUp(async () => {
    if (guest === undefined) return;
    const env = process.env;
    const names = {
      sessions: env["GAME_SESSIONS_TABLE"] ?? "",
      seats: env["SEAT_ASSIGNMENTS_TABLE"] ?? "",
      stats: env["PLAYER_STATS_TABLE"] ?? "",
    };
    const playerId = `GUEST#${guest.identityId}`;
    const seats = createDynamoSeatAssignmentDao(names.seats);
    const stats = createDynamoPlayerStatsDao(names.stats);
    const sessions = createDynamoGameSessionDao(names);
    for (const seat of await seats.list(playerId)) {
      await sessions.delete(seat.sessionId);
      await seats.delete(playerId, seat.sessionId);
    }
    for (const item of await stats.list(playerId)) await stats.delete(playerId, item.statsKey);
  });

  it("plays, resumes, undoes, abandons, and counts the loss", async () => {
    const me = await guestCredentials(identityPoolId() ?? "");
    guest = me;
    const call = async (path: string, method = "GET", body?: unknown) => {
      const response = await signedFetch(url(path), me, {
        method,
        ...(body === undefined ? {} : { body }),
      });
      return { status: response.status, json: await response.json() };
    };
    const started = await call("v1/sessions", "POST", {
      gameId: "spider-solitaire",
      options: { suits: 1 },
    });
    expect(started.status).toBe(201);
    const envelope = SessionEnvelopeSchema.parse(started.json);
    const sessionId = envelope.session.sessionId;
    expect(JSON.stringify(envelope)).not.toContain("seed");

    /* Resume reads an eventually consistent index, so it may need a moment. */
    let current = await call("v1/sessions/current?gameId=spider-solitaire");
    for (let attempt = 0; attempt < 10 && current.status === 404; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      current = await call("v1/sessions/current?gameId=spider-solitaire");
    }
    expect(SessionEnvelopeSchema.parse(current.json).session.sessionId).toBe(sessionId);

    const hint = await call(`v1/sessions/${sessionId}/hint`);
    expect(hint.status).toBe(200);
    const action = envelope.legalActions[0];
    if (action === undefined) throw new Error("A fresh deal has legal actions.");
    const moved = await call(`v1/sessions/${sessionId}/actions`, "POST", {
      actionId: action.actionId,
      expectedVersion: 0,
      source: "POINTER",
    });
    expect(moved.status).toBe(200);
    const stale = await call(`v1/sessions/${sessionId}/actions`, "POST", {
      actionId: action.actionId,
      expectedVersion: 0,
      source: "POINTER",
    });
    expect(stale.status).toBe(409);
    const undone = await call(`v1/sessions/${sessionId}/undo`, "POST", {
      expectedVersion: 1,
      source: "KEYBOARD",
    });
    const afterUndo = SessionEnvelopeSchema.parse(undone.json);
    /* Undo replays the history without its last action, so the move no longer counts. */
    expect(afterUndo.session.summary).toMatchObject({ moveCount: 0, undoCount: 1 });
    const next = afterUndo.legalActions[0];
    if (next === undefined) throw new Error("The undone deal has legal actions.");
    const replayed = await call(`v1/sessions/${sessionId}/actions`, "POST", {
      actionId: next.actionId,
      expectedVersion: 2,
      source: "VOICE",
    });
    expect(SessionEnvelopeSchema.parse(replayed.json).session.summary).toMatchObject({
      moveCount: 1,
    });
    const abandoned = await call(`v1/sessions/${sessionId}/abandon`, "POST", {
      expectedVersion: 3,
    });
    expect(SessionEnvelopeSchema.parse(abandoned.json).session.status).toBe("ABANDONED");
    const again = await call(`v1/sessions/${sessionId}/abandon`, "POST", { expectedVersion: 4 });
    expect(again.status).toBe(422);

    const stats = StatsResponseSchema.parse((await call("v1/players/me/stats")).json);
    expect(stats.stats).toEqual([
      expect.objectContaining({
        gameId: "spider-solitaire",
        gamesPlayed: 1,
        gamesLost: 1,
        totalMoves: 1,
      }),
    ]);
  });
});

import { expect, it } from "vitest";
import { createDynamoGameSessionDao } from "../../src/dao/gameSession/dynamoGameSessionDao";
import { createDynamoPlayerStatsDao } from "../../src/dao/playerStats/dynamoPlayerStatsDao";
import { createDynamoSeatAssignmentDao } from "../../src/dao/seatAssignment/dynamoSeatAssignmentDao";
import {
  DecisionResponseSchema,
  ResolutionResponseSchema,
  SessionEnvelopeSchema,
  type DecisionResponse,
} from "../../src/models/api";
import { apiUrl } from "./apiUrl";
import { identityPoolId, signedFetch, type GuestCredentials } from "./guestCredentials";
import { playCredentials } from "./callers";
import { cleanUp, describeWrites, localTarget } from "./stage";

/*
 * The decision routes through the deployed DecisionApi (action-decision.md
 * section 4, AD-7). Test answers "itest" commands with fixed responses, so
 * these turns are repeatable and call no model. Test only, since turns move
 * the guest's game; the guest's items are deleted after the file.
 */
describeWrites("decisions as a player", () => {
  let guest: GuestCredentials | undefined;
  cleanUp(async () => {
    /* The local server keeps nothing between runs; only a stage has tables to clean. */
    if (guest === undefined || localTarget()) return;
    const env = process.env;
    const names = {
      sessions: env["GAME_SESSIONS_TABLE"] ?? "",
      seats: env["SEAT_ASSIGNMENTS_TABLE"] ?? "",
      stats: env["PLAYER_STATS_TABLE"] ?? "",
    };
    const playerId = guest.playerId;
    const seats = createDynamoSeatAssignmentDao(names.seats);
    const stats = createDynamoPlayerStatsDao(names.stats);
    const sessions = createDynamoGameSessionDao(names);
    for (const seat of await seats.list(playerId)) {
      await sessions.delete(seat.sessionId);
      await seats.delete(playerId, seat.sessionId);
    }
    for (const item of await stats.list(playerId)) await stats.delete(playerId, item.statsKey);
  });

  it("proposes, confirms, offers choices, answers by voice, and refuses nonsense", async () => {
    const me = await playCredentials(identityPoolId() ?? "");
    guest = me;
    const call = async (path: string, body: unknown) => {
      const response = await signedFetch(new URL(path, apiUrl()), me, { method: "POST", body });
      return { status: response.status, json: await response.json() };
    };
    const started = SessionEnvelopeSchema.parse(
      (await call("v1/sessions", { gameId: "spider-solitaire", options: { suits: 1 } })).json,
    );
    const sessionId = started.session.sessionId;
    const decide = async (
      transcript: string,
      version: number,
      pending: DecisionResponse | null = null,
    ) => {
      const pendingPrompt =
        pending === null
          ? null
          : pending.choices !== null
            ? {
                decisionId: pending.decisionId,
                kind: "CHOICES",
                actionIds: pending.choices.map((choice) => choice.actionId),
                appAction: null,
              }
            : {
                decisionId: pending.decisionId,
                kind: "CONFIRMATION",
                actionIds: [pending.proposal?.actionId],
                appAction: null,
              };
      const reply = await call("v1/decisions", {
        transcript,
        transcriptSource: "TYPED",
        context: { screen: "GAME", sessionId, expectedVersion: version, pendingPrompt },
      });
      expect(reply.status).toBe(200);
      return DecisionResponseSchema.parse(reply.json);
    };

    const deal = await decide("itest deal", 0);
    expect(deal).toMatchObject({ outcome: "PROPOSED", proposal: { actionId: "DEAL_ROW" } });
    const confirmed = await call(`v1/decisions/${deal.decisionId}/resolution`, {
      resolution: "CONFIRMED",
      sessionId,
      actionId: "DEAL_ROW",
      expectedVersion: 0,
      clientLatencyMs: 800,
    });
    expect(ResolutionResponseSchema.parse(confirmed.json).session?.session.version).toBe(1);

    /* The deal is random, so the board offers two moves or, rarely, one. */
    const choices = await decide("itest any move", 1);
    expect(["CHOICES", "PROPOSED"]).toContain(choices.outcome);
    const second = await decide(
      choices.outcome === "CHOICES" ? "itest two" : "itest yes",
      1,
      choices,
    );
    expect(second.outcome).toBe("RESOLVED");
    expect(second.session?.session.version).toBe(2);

    const zoom = await decide("itest zoom in", 2);
    expect(zoom).toMatchObject({ outcome: "APP_ACTION", appAction: { action: "ZOOM_IN" } });
    expect((await decide("itest gibberish", 2)).outcome).toBe("UNRECOGNIZED");
  });
});

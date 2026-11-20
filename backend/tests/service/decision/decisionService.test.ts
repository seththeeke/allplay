import { describe, expect, it } from "vitest";
import { createInMemoryDecisionDao } from "../../../src/dao/decision/inMemoryDecisionDao";
import { DecisionRequestSchema } from "../../../src/models/api";
import { createDecisionService } from "../../../src/service/decision/decisionService";

const request = (transcript: string, sessionId: string | null = null) =>
  DecisionRequestSchema.parse({
    transcript,
    transcriptSource: "WHISPER",
    context: {
      screen: "GAME",
      sessionId,
      expectedVersion: sessionId === null ? null : 4,
      pendingDecisionId: null,
    },
  });

describe("decision intake", () => {
  it("records each turn and answers with what it heard", async () => {
    const dao = createInMemoryDecisionDao();
    let tick = 0;
    const service = createDecisionService({
      dao,
      now: () => new Date(Date.UTC(2026, 10, 20, 12, 0, tick++)),
    });
    const reply = await service.decide("GUEST#a", request("  move three to seven  "));
    expect(reply).toMatchObject({
      outcome: "UNRECOGNIZED",
      displayText: 'I heard "move three to seven". Understanding commands is not wired up yet.',
      speech: "I heard move three to seven.",
      proposal: null,
      session: null,
    });
    const stored = await dao.get(reply.decisionId);
    expect(stored).toMatchObject({
      playerId: "GUEST#a",
      transcript: "move three to seven",
      transcriptSource: "WHISPER",
      uiContext: { screen: "GAME", pendingPrompt: null },
      outcome: "UNRECOGNIZED",
      failureClass: "HARD",
      entityVersion: 1,
    });
    expect(stored?.sessionId).toBeUndefined();
    expect(stored?.ttl).toBe(Math.floor(Date.UTC(2026, 10, 20, 12, 0, 0) / 1000) + 30 * 24 * 3600);
    const inGame = await service.decide("GUEST#a", request("deal", "01SESSION"));
    expect(await dao.get(inGame.decisionId)).toMatchObject({
      sessionId: "01SESSION",
      sessionVersion: 4,
    });
    expect((await service.recent("GUEST#a", 10)).map((d) => d.transcript)).toEqual([
      "deal",
      "move three to seven",
    ]);
    expect(await service.recent("GUEST#b", 10)).toEqual([]);
  });

  it("uses the clock and ULIDs by default", async () => {
    const reply = await createDecisionService({ dao: createInMemoryDecisionDao() }).decide(
      "GUEST#a",
      request("hint"),
    );
    expect(reply.decisionId).toMatch(/^[0-9A-Z]{26}$/);
  });
});

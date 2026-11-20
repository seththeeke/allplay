import { describe, expect, it } from "vitest";
import { DecisionExistsError, DecisionMissingError } from "../../../src/dao/decision/decisionDao";
import { createInMemoryDecisionDao } from "../../../src/dao/decision/inMemoryDecisionDao";
import type { Decision } from "../../../src/models/decision";

function decision(decisionId: string, playerId: string, createdAt: string): Decision {
  return {
    decisionId,
    playerId,
    transcriptSource: "TYPED",
    transcript: "deal",
    alternatives: [],
    uiContext: { screen: "HOME", pendingPrompt: null },
    outcome: "UNRECOGNIZED",
    failureClass: "HARD",
    serverLatencyMs: 1,
    dayOutcomeKey: "2026-11-20#HARD",
    ttl: 1,
    entityVersion: 1,
    createdAt,
    updatedAt: createdAt,
  };
}

describe("InMemoryDecisionDao", () => {
  it("creates, reads copies, refuses duplicates and lists a player's newest first", async () => {
    const dao = createInMemoryDecisionDao();
    await dao.create(decision("A", "p1", "2026-11-20T12:00:00.000Z"));
    await dao.create(decision("C", "p1", "2026-11-20T12:00:01.000Z"));
    await dao.create(decision("B", "p1", "2026-11-20T12:00:01.000Z"));
    await dao.create(decision("D", "p2", "2026-11-20T12:00:02.000Z"));
    await expect(
      dao.create(decision("A", "p1", "2026-11-20T12:00:00.000Z")),
    ).rejects.toBeInstanceOf(DecisionExistsError);
    expect((await dao.listByPlayer("p1", 10)).map((d) => d.decisionId)).toEqual(["C", "B", "A"]);
    expect(await dao.listByPlayer("p1", 1)).toHaveLength(1);
    const read = await dao.get("A");
    if (read === null) throw new Error("missing");
    read.transcript = "changed";
    expect((await dao.get("A"))?.transcript).toBe("deal");
    expect(await dao.get("Z")).toBeNull();
    await dao.update({ ...decision("A", "p1", "2026-11-20T12:00:00.000Z"), outcome: "EXPIRED" });
    expect((await dao.get("A"))?.outcome).toBe("EXPIRED");
    await expect(
      dao.update(decision("Z", "p1", "2026-11-20T12:00:00.000Z")),
    ).rejects.toBeInstanceOf(DecisionMissingError);
    await expect(dao.create({ ...decision("E", "p1", "bad date") })).rejects.toThrow();
  });
});

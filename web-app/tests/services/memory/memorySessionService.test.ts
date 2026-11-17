import { describe, expect, it } from "vitest";
import { ApiRequestError } from "../../../src/services/errors";
import { createMemorySessionService } from "../../../src/services/memory/memorySessionService";
import { createMemoryStore } from "../../../src/services/memory/memoryStore";
import type { SpiderState } from "../../../test-data/spider/simulator";
import { must } from "../../must";

const SPIDER = "spider-solitaire";
const service = () => createMemorySessionService(createMemoryStore(null), () => 7);

async function errorCode(promise: Promise<unknown>): Promise<string> {
  const error: unknown = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (!(error instanceof ApiRequestError)) throw new Error("expected an ApiRequestError");
  return `${String(error.status)} ${error.body.code}`;
}

describe("memory session service: winning", () => {
  it("marks the session WON and adds a win event when the eighth run completes", async () => {
    const store = createMemoryStore(null);
    const sessions = createMemorySessionService(store, () => 7);
    const { session } = await sessions.start(SPIDER);
    const stored = store.read<{ state: SpiderState }>(
      "allplay.memory.session.spider-solitaire",
      null as never,
    );
    const spades = Object.values(stored.state.cards).filter((card) => card.suit === "SPADES");
    const run = Array.from({ length: 13 }, (_, index) =>
      must(spades.find((card) => card.rank === 13 - index)),
    );
    for (const card of run) card.faceUp = true;
    stored.state.zones["tableau.1"] = run.slice(0, 12).map((card) => card.id);
    stored.state.zones["tableau.2"] = [must(run[12]).id];
    stored.state.vars.completedRuns = 7;
    store.write("allplay.memory.session.spider-solitaire", stored);
    const won = await sessions.apply(session.sessionId, {
      actionId: "MOVE_UNIT|from=tableau.2|depth=1|to=tableau.1",
      expectedVersion: 0,
      source: "VOICE",
    });
    expect(won.session.status).toBe("WON");
    expect(won.events.map((event) => event.type)).toContain("GAME_WON");
  });
});

describe("memory session service", () => {
  it("has no current session until one starts, then resumes it", async () => {
    const sessions = service();
    expect(await sessions.current(SPIDER)).toBeNull();
    const started = await sessions.start(SPIDER, { suits: 2 });
    expect(started.session).toMatchObject({
      status: "IN_PROGRESS",
      version: 0,
      options: { suits: 2 },
    });
    expect((await sessions.current(SPIDER))?.session.sessionId).toBe(started.session.sessionId);
  });

  it("applies actions with version checks and returns events", async () => {
    const sessions = service();
    const { session } = await sessions.start(SPIDER);
    const next = await sessions.apply(session.sessionId, {
      actionId: "DEAL_ROW",
      expectedVersion: 0,
      source: "POINTER",
    });
    expect(next.session.version).toBe(1);
    expect(next.events[0]?.type).toBe("CARDS_DEALT");
    expect(
      await errorCode(
        sessions.apply(session.sessionId, {
          actionId: "DEAL_ROW",
          expectedVersion: 0,
          source: "POINTER",
        }),
      ),
    ).toBe("409 VERSION_CONFLICT");
    expect(
      await errorCode(
        sessions.apply(session.sessionId, {
          actionId: "BOGUS",
          expectedVersion: 1,
          source: "POINTER",
        }),
      ),
    ).toBe("422 ILLEGAL_ACTION");
  });

  it("undoes, hints and abandons", async () => {
    const sessions = service();
    const { session } = await sessions.start(SPIDER);
    expect(
      await errorCode(sessions.undo(session.sessionId, { expectedVersion: 0, source: "KEYBOARD" })),
    ).toBe("422 ILLEGAL_ACTION");
    const hinted = await sessions.hint(session.sessionId);
    expect(hinted.action).not.toBeNull();
    await sessions.apply(session.sessionId, {
      actionId: must(hinted.action).actionId,
      expectedVersion: 0,
      source: "VOICE",
    });
    const undone = await sessions.undo(session.sessionId, { expectedVersion: 1, source: "VOICE" });
    expect(undone.session.summary).toMatchObject({ score: 498, undoCount: 1 });
    const abandoned = await sessions.abandon(session.sessionId, { expectedVersion: 2 });
    expect(abandoned.session.status).toBe("ABANDONED");
    expect(abandoned.legalActions).toEqual([]);
    expect(await sessions.current(SPIDER)).toBeNull();
    expect(await errorCode(sessions.hint(session.sessionId))).toBe("422 GAME_OVER");
  });

  it("answers unknown games and sessions as not found", async () => {
    const sessions = service();
    expect(await errorCode(sessions.start("checkers"))).toBe("404 NOT_FOUND");
    expect(await errorCode(sessions.current("checkers"))).toBe("404 NOT_FOUND");
    expect(await errorCode(sessions.hint("missing"))).toBe("404 NOT_FOUND");
  });
});

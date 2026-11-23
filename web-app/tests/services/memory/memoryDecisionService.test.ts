import { describe, expect, it } from "vitest";
import type { DecisionRequest, DecisionResponse } from "../../../src/models/api";
import { pendingPromptOf, resolutionFor } from "../../../src/voice/turns";
import { createServices } from "../../../src/services/createServices";
import { createMemoryStore } from "../../../src/services/memory/memoryStore";
import { must } from "../../must";
import type { SpiderState } from "../../../test-data/spider/simulator";
import { LOCAL_CONFIG } from "../../renderApp";

async function setup() {
  const services = createServices(LOCAL_CONFIG, createMemoryStore(null), () => 7);
  const envelope = await services.sessions.start("spider-solitaire");
  const request = (
    transcript: string,
    pending: DecisionResponse | null = null,
    version = 0,
  ): DecisionRequest => ({
    transcript,
    transcriptSource: "TRANSCRIBE",
    context: {
      screen: "GAME",
      sessionId: envelope.session.sessionId,
      expectedVersion: version,
      pendingPrompt: pendingPromptOf(pending),
    },
  });
  const game = { sessionId: envelope.session.sessionId, version: 0 };
  return { services, envelope, request, game };
}

describe("memory decision service", () => {
  it("proposes a single move and applies it on confirmation", async () => {
    const { services, request, game } = await setup();
    const proposal = await services.decisions.decide(request("deal"));
    expect(proposal).toMatchObject({ outcome: "PROPOSED", proposal: { actionId: "DEAL_ROW" } });
    const { session } = await services.decisions.resolve(
      proposal.decisionId,
      resolutionFor(proposal, "CONFIRMED", game, 900),
    );
    expect(session?.session.version).toBe(1);
  });

  it("applies a move when the player says yes", async () => {
    const { services, request } = await setup();
    const proposal = await services.decisions.decide(request("deal"));
    const answer = await services.decisions.decide(request("yes", proposal));
    expect(answer.outcome).toBe("RESOLVED");
    expect(answer.session?.session.version).toBe(1);
  });

  it("cancels on no, and rejects resolutions without applying anything", async () => {
    const { services, request, game } = await setup();
    const proposal = await services.decisions.decide(request("deal"));
    expect((await services.decisions.decide(request("no", proposal))).displayText).toBe(
      "Cancelled.",
    );
    const another = await services.decisions.decide(request("deal"));
    const rejected = await services.decisions.resolve(
      another.decisionId,
      resolutionFor(another, "REJECTED", game, 0),
    );
    expect(rejected.session).toBeNull();
    /* A confirmation without an action (an application action) applies nothing. */
    expect(
      (
        await services.decisions.resolve("unknown", {
          resolution: "CONFIRMED",
          sessionId: game.sessionId,
          actionId: null,
          expectedVersion: 0,
          clientLatencyMs: 0,
        })
      ).session,
    ).toBeNull();
  });

  it("offers numbered choices for an ambiguous card and applies the chosen one", async () => {
    const store = createMemoryStore(null);
    const services = createServices(LOCAL_CONFIG, store, () => 7);
    const envelope = await services.sessions.start("spider-solitaire");
    /* Hand-build a table where two sevens can each go onto an eight. */
    const key = "allplay.memory.session.spider-solitaire";
    const stored = store.read<{ state: SpiderState }>(key, null as never);
    const cards = Object.values(stored.state.cards);
    const [sevenA, sevenB] = cards.filter((card) => card.rank === 7);
    const eight = must(cards.find((card) => card.rank === 8));
    for (const card of [must(sevenA), must(sevenB), eight]) card.faceUp = true;
    const used = new Set([must(sevenA).id, must(sevenB).id, eight.id]);
    for (const zoneId of Object.keys(stored.state.zones)) {
      stored.state.zones[zoneId] = (stored.state.zones[zoneId] ?? []).filter((id) => !used.has(id));
    }
    stored.state.zones["tableau.1"]?.push(must(sevenA).id);
    stored.state.zones["tableau.2"]?.push(must(sevenB).id);
    stored.state.zones["tableau.3"]?.push(eight.id);
    store.write(key, stored);
    const request: DecisionRequest = {
      transcript: "the seven onto the eight",
      transcriptSource: "TRANSCRIBE",
      context: {
        screen: "GAME",
        sessionId: envelope.session.sessionId,
        expectedVersion: 0,
        pendingPrompt: null,
      },
    };
    const decision = await services.decisions.decide(request);
    expect(decision.outcome).toBe("CHOICES");
    expect(decision.choices?.slice(0, 2).map((choice) => choice.number)).toEqual([1, 2]);
    const answer = await services.decisions.decide({
      ...request,
      transcript: "two",
      context: { ...request.context, pendingPrompt: pendingPromptOf(decision) },
    });
    expect(answer.session?.session.version).toBe(1);
    const chooseAgain = await services.decisions.decide(request);
    const game = { sessionId: envelope.session.sessionId, version: 1 };
    const missing = resolutionFor(chooseAgain, "CHOSE_OPTION", game, 10, 9);
    expect(missing.actionId).toBeNull();
    expect((await services.decisions.resolve(chooseAgain.decisionId, missing)).session).toBeNull();
    const viaResolve = await services.decisions.resolve(
      chooseAgain.decisionId,
      resolutionFor(chooseAgain, "CHOSE_OPTION", game, 10, 1),
    );
    expect(viaResolve.session?.session.version).toBe(2);
  });

  it("asks before destructive application actions and returns the action on yes", async () => {
    const { services, request } = await setup();
    const decision = await services.decisions.decide(request("new game"));
    expect(decision).toMatchObject({
      outcome: "APP_ACTION",
      appAction: { action: "NEW_GAME" },
      displayText: "Are you sure?",
    });
    const answer = await services.decisions.decide(request("yes", decision));
    expect(answer.appAction?.action).toBe("NEW_GAME");
    expect((await services.decisions.decide(request("zoom in"))).displayText).toBe("OK.");
  });

  it("auto-applies a unique move when auto confirm is on", async () => {
    const { services, request } = await setup();
    await services.preferences.patchApp({ autoConfirm: true });
    const decision = await services.decisions.decide(request("deal"));
    expect(decision.outcome).toBe("AUTO_APPLIED");
    expect(decision.session?.session.version).toBe(1);
  });

  it("undoes through the session and answers hints directly", async () => {
    const { services, request } = await setup();
    await services.preferences.patchApp({ autoConfirm: true });
    await services.decisions.decide(request("deal"));
    const undone = await services.decisions.decide(request("undo", null, 1));
    expect(undone.session?.session.summary["undoCount"]).toBe(1);
    const hint = await services.decisions.decide(request("hint", null, 2));
    expect(hint.outcome).toBe("RESOLVED");
    expect(hint.displayText).toMatch(/^Move /);
  });

  it("does not understand game moves outside a game or nonsense", async () => {
    const { services, request } = await setup();
    const home = await services.decisions.decide({
      ...request("deal"),
      context: { screen: "HOME", sessionId: null, expectedVersion: null, pendingPrompt: null },
    });
    expect(home.outcome).toBe("UNRECOGNIZED");
    expect((await services.decisions.decide(request("sing a song"))).outcome).toBe("UNRECOGNIZED");
    const decision = await services.decisions.decide(request("deal"));
    expect((await services.decisions.decide(request("number four", decision))).outcome).not.toBe(
      "RESOLVED",
    );
  });

  it("acts without asking in conversational mode and stays silent on side talk", async () => {
    const { services, request } = await setup();
    const spoken = (transcript: string) => {
      const base = request(transcript);
      return { ...base, context: { ...base.context, voiceMode: "CONVERSATIONAL" as const } };
    };
    expect(await services.decisions.decide(spoken("banana sandwich"))).toMatchObject({
      outcome: "IGNORED",
      silent: true,
    });
    const moved = await services.decisions.decide(spoken("deal"));
    expect(moved).toMatchObject({ outcome: "AUTO_APPLIED", speech: "Done." });
    expect(moved.session?.session.version).toBe(1);
  });

  it("greets once and then welcomes back, and acknowledges a conversational resolution", async () => {
    const { services, envelope, game } = await setup();
    const id = envelope.session.sessionId;
    expect((await services.decisions.greet(id)).kind).toBe("GREETING");
    expect((await services.decisions.greet(id)).kind).toBe("WELCOME_BACK");
    const resolved = await services.decisions.resolve("d", {
      resolution: "CONFIRMED",
      sessionId: game.sessionId,
      actionId: "DEAL_ROW",
      expectedVersion: 0,
      clientLatencyMs: 1,
      voiceMode: "CONVERSATIONAL",
    });
    expect(resolved.speech).toBe("Done.");
  });
});

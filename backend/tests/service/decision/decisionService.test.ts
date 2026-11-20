import { describe, expect, it } from "vitest";
import type { SessionEnvelope } from "../../../src/models/api";
import { LlmUnavailableError } from "../../../src/service/decision/llm/llmClient";
import { GameSessionError } from "../../../src/service/gameSession/errors";
import { ask, FIRST_MOVE, heard, numberOf, PLAYER, setupDecider, type Answers } from "./decider";

const texts = (envelope: SessionEnvelope) =>
  new Map<string, string>([
    ["UNDO", "Undo the last move"],
    ["HINT", "Show a hint"],
    ...envelope.legalActions.map((a) => [a.actionId, a.text] as const),
  ]);

/** A model that classifies by keyword and selects the given action ids for game requests. */
function model(envelope: () => SessionEnvelope, picks: Record<string, string[]>): Answers {
  return {
    classify: (request) => {
      const t = heard(request);
      if (t === "yes") return { category: "RESPONSE", response: "CONFIRM", optionNumber: null };
      if (t === "no") return { category: "RESPONSE", response: "REJECT", optionNumber: null };
      if (/^(one|two|three|seven)$/.test(t))
        return {
          category: "RESPONSE",
          response: "OPTION",
          optionNumber: { one: 1, two: 2, three: 3, seven: 7 }[t] ?? null,
        };
      if (t.startsWith("app"))
        return { category: "APPLICATION", response: null, optionNumber: null };
      if (t === "gibberish")
        return { category: "UNRECOGNIZED", response: null, optionNumber: null };
      return { category: "GAME", response: null, optionNumber: null };
    },
    select_actions: (request) => ({
      selected: (picks[heard(request)] ?? []).map((id) => numberOf(request, id, texts(envelope()))),
      confidence: "HIGH",
      requested: heard(request) === "ten to one" ? "column ten to column one" : null,
    }),
    select_app_action: (request) => {
      const t = heard(request);
      if (t === "app bigger") return { action: "ZOOM_IN", params: {} };
      if (t === "app dark") return { action: "SET_THEME", params: { theme: "DARK" } };
      if (t === "app new game") return { action: "NEW_GAME", params: {} };
      if (t === "app chess") return { action: "OPEN_GAME", params: { gameId: "chess" } };
      if (t === "app broken") return { action: "SET_THEME", params: { theme: "PLAID" } };
      if (t === "app garbage") return "not an object";
      return { action: "NONE", params: {} };
    },
  };
}

async function started() {
  let envelope: SessionEnvelope | undefined;
  const current = () => envelope as SessionEnvelope;
  const picks: Record<string, string[]> = {};
  const setup = setupDecider(model(current, picks));
  envelope = await setup.sessions.start(PLAYER, { gameId: "spider-solitaire" });
  const others = envelope.legalActions.map((a) => a.actionId).filter((id) => id !== FIRST_MOVE);
  const second = others[0] as string;
  Object.assign(picks, {
    "one to six": [FIRST_MOVE],
    "move the card": [FIRST_MOVE, second],
    hint: ["HINT"],
    undo: ["UNDO"],
    nothing: [],
    everything: [FIRST_MOVE, ...others.slice(0, 4)],
  });
  const inGame = (version = current().session.version) => ({
    sessionId: current().session.sessionId,
    expectedVersion: version,
  });
  const refresh = async () => {
    envelope = await setup.sessions.get(PLAYER, current().session.sessionId);
    return envelope;
  };
  return { ...setup, current, inGame, refresh, second };
}

describe("action decider: game turns", () => {
  it("proposes one move, records both layers, and applies it on confirmation", async () => {
    const t = await started();
    const proposed = await t.decider.decide(PLAYER, ask("one to six", t.inGame()));
    expect(proposed).toMatchObject({
      outcome: "PROPOSED",
      proposal: { actionId: FIRST_MOVE },
      speech: expect.stringContaining("Say yes to confirm") as string,
    });
    const stored = await t.dao.get(proposed.decisionId);
    expect(stored).toMatchObject({
      gameId: "spider-solitaire",
      sessionVersion: 0,
      classification: { category: "GAME", modelId: "fake-model" },
      selection: { selectedIds: [FIRST_MOVE], confidence: "HIGH" },
      proposal: { kind: "PROPOSED", actionIds: [FIRST_MOVE] },
      outcome: "PROPOSED",
      failureClass: "PENDING",
      dayOutcomeKey: "2026-11-20#PENDING",
    });
    expect(stored?.candidateCount).toBeGreaterThan(1);
    expect(stored?.candidatesDigest).toMatch(/^[0-9a-f]{64}$/);
    const prompt = t.llm.requests.find((r) => r.tool.name === "select_actions");
    expect(prompt?.system[1]).toContain("Columns are numbered 1 to 10");
    expect(prompt?.user).toContain("column 1: 5 face down; face up from bottom to top:");
    expect(prompt?.user).toContain("1 | hint | Show a hint");

    const resolved = await t.decider.resolve(PLAYER, proposed.decisionId, {
      resolution: "CONFIRMED",
      optionNumber: null,
      expectedVersion: 0,
      clientLatencyMs: 900,
    });
    expect(resolved.session?.session.version).toBe(1);
    expect(await t.dao.get(proposed.decisionId)).toMatchObject({
      outcome: "CONFIRMED",
      failureClass: "NONE",
      clientLatencyMs: 900,
      dayOutcomeKey: "2026-11-20#NONE",
    });
  });

  it("confirms by voice: yes applies the pending move", async () => {
    const t = await started();
    const proposed = await t.decider.decide(PLAYER, ask("one to six", t.inGame()));
    const yes = await t.decider.decide(
      PLAYER,
      ask("yes", { ...t.inGame(), pendingDecisionId: proposed.decisionId }),
    );
    expect(yes.outcome).toBe("RESOLVED");
    expect(yes.session?.session.version).toBe(1);
    expect((await t.dao.get(proposed.decisionId))?.outcome).toBe("CONFIRMED");
    const classify = t.llm.requests.filter((r) => r.tool.name === "classify").at(-1);
    expect(classify?.user).toContain("CONFIRMATION");
    expect(classify?.user).toContain("RESPONSE");
  });

  it("offers choices and applies the one picked by voice or by resolution", async () => {
    const t = await started();
    const choices = await t.decider.decide(PLAYER, ask("move the card", t.inGame()));
    expect(choices.outcome).toBe("CHOICES");
    expect(choices.choices?.map((c) => c.actionId)).toEqual([FIRST_MOVE, t.second]);
    expect(choices.displayText).toContain("1: Move");
    const yes = await t.decider.decide(
      PLAYER,
      ask("yes", { ...t.inGame(), pendingDecisionId: choices.decisionId }),
    );
    expect(yes).toMatchObject({
      outcome: "UNRECOGNIZED",
      displayText: expect.stringContaining("number") as string,
    });
    const three = await t.decider.decide(
      PLAYER,
      ask("three", { ...t.inGame(), pendingDecisionId: choices.decisionId }),
    );
    expect(three.displayText).toBe("There is no choice with that number.");
    const seven = await t.decider.decide(
      PLAYER,
      ask("seven", { ...t.inGame(), pendingDecisionId: choices.decisionId }),
    );
    expect(seven.outcome).toBe("UNRECOGNIZED");
    const two = await t.decider.decide(
      PLAYER,
      ask("two", { ...t.inGame(), pendingDecisionId: choices.decisionId }),
    );
    expect(two.outcome).toBe("RESOLVED");
    expect(await t.dao.get(choices.decisionId)).toMatchObject({
      outcome: "CHOSE_OPTION",
      failureClass: "SOFT",
    });

    await t.refresh();
    const again = await t.decider.decide(PLAYER, ask("undo", t.inGame()));
    expect(again.proposal?.actionId).toBe("UNDO");
    const undone = await t.decider.resolve(PLAYER, again.decisionId, {
      resolution: "CONFIRMED",
      optionNumber: null,
      expectedVersion: null,
      clientLatencyMs: 1,
    });
    expect(undone.session?.view.status.canUndo).toBe(false);

    await t.refresh();
    const picked = await t.decider.decide(PLAYER, ask("move the card", t.inGame()));
    await expect(
      t.decider.resolve(PLAYER, picked.decisionId, {
        resolution: "CHOSE_OPTION",
        optionNumber: 4,
        expectedVersion: null,
        clientLatencyMs: 1,
      }),
    ).rejects.toThrow("no choice");
    const chosen = await t.decider.resolve(PLAYER, picked.decisionId, {
      resolution: "CHOSE_OPTION",
      optionNumber: 1,
      expectedVersion: t.current().session.version,
      clientLatencyMs: 1,
    });
    expect(chosen.session).not.toBeNull();
  });

  it("cancels by voice or resolution, and a new command expires the open prompt", async () => {
    const t = await started();
    const proposed = await t.decider.decide(PLAYER, ask("one to six", t.inGame()));
    const one = await t.decider.decide(
      PLAYER,
      ask("one", { ...t.inGame(), pendingDecisionId: proposed.decisionId }),
    );
    expect(one.displayText).toBe("Say yes to confirm, or no to cancel.");
    const no = await t.decider.decide(
      PLAYER,
      ask("no", { ...t.inGame(), pendingDecisionId: proposed.decisionId }),
    );
    expect(no).toMatchObject({ outcome: "RESOLVED", displayText: "Cancelled." });
    expect(await t.dao.get(proposed.decisionId)).toMatchObject({
      outcome: "REJECTED",
      failureClass: "HARD",
    });

    const next = await t.decider.decide(PLAYER, ask("one to six", t.inGame()));
    await t.decider.decide(
      PLAYER,
      ask("move the card", { ...t.inGame(), pendingDecisionId: next.decisionId }),
    );
    expect((await t.dao.get(next.decisionId))?.outcome).toBe("EXPIRED");

    const last = await t.decider.decide(PLAYER, ask("one to six", t.inGame()));
    expect(
      await t.decider.resolve(PLAYER, last.decisionId, {
        resolution: "REJECTED",
        optionNumber: null,
        expectedVersion: null,
        clientLatencyMs: 5,
      }),
    ).toEqual({ session: null });
    /* A finished decision is no longer a pending prompt. */
    const stale = await t.decider.decide(
      PLAYER,
      ask("yes", { ...t.inGame(), pendingDecisionId: last.decisionId }),
    );
    expect(stale.outcome).toBe("UNRECOGNIZED");
  });

  it("proposes the hinted move, says why a move is refused, and refuses over-broad selections", async () => {
    const t = await started();
    const hint = await t.decider.decide(PLAYER, ask("hint", t.inGame()));
    expect(hint).toMatchObject({
      outcome: "PROPOSED",
      displayText: expect.stringMatching(/^Hint: Move .+\. Confirm to make this move\.$/) as string,
      speech: expect.stringContaining("Say yes to make it") as string,
    });
    const hinted = hint.proposal?.actionId;
    expect(t.current().legalActions.map((a) => a.actionId)).toContain(hinted);
    const made = await t.decider.decide(
      PLAYER,
      ask("yes", { ...t.inGame(), pendingDecisionId: hint.decisionId }),
    );
    expect(made.session?.session.version).toBe(1);
    await t.refresh();
    const refused = await t.decider.decide(PLAYER, ask("ten to one", t.inGame()));
    expect(refused.displayText).toBe(
      "That move is not allowed right now: column ten to column one. Say hint if you'd like a suggestion.",
    );
    const fresh = await started();
    for (const words of ["nothing", "everything"]) {
      const reply = await fresh.decider.decide(PLAYER, ask(words, fresh.inGame()));
      expect(reply.displayText).toContain("which move");
      expect(reply.displayText).toContain("say hint");
    }
    const stuck = setupDecider(model(t.current, { hint: ["HINT"] }), {
      sessions: { ...t.sessions, hint: () => Promise.resolve({ action: null, text: "none" }) },
    });
    const none = await stuck.decider.decide(PLAYER, ask("hint", t.inGame()));
    expect(none).toMatchObject({
      outcome: "RESOLVED",
      displayText: "There are no moves left. Try undo or a new game.",
    });
    const gibberish = await t.decider.decide(PLAYER, ask("gibberish", t.inGame()));
    expect(gibberish.displayText).toContain("didn't understand");
  });

  it("applies at once when the player auto-confirms and the model is sure", async () => {
    const t = await started();
    const auto = setupDecider(model(t.current, { "one to six": [FIRST_MOVE] }), {
      sessions: t.sessions,
      preferences: () => Promise.resolve({ autoConfirm: true }),
    });
    const applied = await auto.decider.decide(PLAYER, ask("one to six", t.inGame()));
    expect(applied.outcome).toBe("AUTO_APPLIED");
    expect(applied.session?.session.version).toBe(1);
    expect(
      await auto.decider.resolve(PLAYER, applied.decisionId, {
        resolution: "ACKNOWLEDGED",
        optionNumber: null,
        expectedVersion: null,
        clientLatencyMs: 3,
      }),
    ).toEqual({ session: null });
  });

  it("expires a confirmation whose game moved on, and returns the conflict", async () => {
    const t = await started();
    const proposed = await t.decider.decide(PLAYER, ask("one to six", t.inGame()));
    await t.sessions.applyAction(PLAYER, t.current().session.sessionId, {
      actionId: "DEAL_ROW",
      expectedVersion: 0,
    });
    await expect(
      t.decider.decide(
        PLAYER,
        ask("yes", { ...t.inGame(), pendingDecisionId: proposed.decisionId }),
      ),
    ).rejects.toBeInstanceOf(GameSessionError);
    expect((await t.dao.get(proposed.decisionId))?.outcome).toBe("EXPIRED");
  });

  it("does not offer game moves off the game screen or without a live game", async () => {
    const t = await started();
    const home = await t.decider.decide(PLAYER, ask("one to six", { screen: "HOME" }));
    expect(home.outcome).toBe("UNRECOGNIZED");
    const classify = t.llm.requests.at(-1);
    expect(classify?.user).toContain("Offered categories: APPLICATION, UNRECOGNIZED.");
    const missing = await t.decider.decide(
      PLAYER,
      ask("one to six", { sessionId: "nope", expectedVersion: 0 }),
    );
    expect(missing.displayText).toContain("no game in progress");
  });
});

describe("action decider: application turns", () => {
  it("selects application actions, confirming only the destructive ones", async () => {
    const t = await started();
    const bigger = await t.decider.decide(PLAYER, ask("app bigger", { screen: "HOME" }));
    expect(bigger).toMatchObject({
      outcome: "APP_ACTION",
      appAction: { action: "ZOOM_IN" },
      displayText: "Making everything bigger.",
    });
    expect(
      await t.decider.resolve(PLAYER, bigger.decisionId, {
        resolution: "ACKNOWLEDGED",
        optionNumber: null,
        expectedVersion: null,
        clientLatencyMs: 1,
      }),
    ).toEqual({ session: null });
    const dark = await t.decider.decide(PLAYER, ask("app dark", t.inGame()));
    expect(dark.appAction).toEqual({ action: "SET_THEME", theme: "DARK" });

    const fresh = await t.decider.decide(PLAYER, ask("app new game", t.inGame()));
    expect(fresh).toMatchObject({
      outcome: "APP_ACTION",
      displayText: "Start a new game?",
      appAction: { action: "NEW_GAME", gameId: "spider-solitaire", options: {} },
    });
    const yes = await t.decider.decide(
      PLAYER,
      ask("yes", { ...t.inGame(), pendingDecisionId: fresh.decisionId }),
    );
    expect(yes).toMatchObject({ outcome: "RESOLVED", appAction: { action: "NEW_GAME" } });

    for (const words of ["app chess", "app broken", "app garbage", "app nothing"]) {
      const reply = await t.decider.decide(PLAYER, ask(words, t.inGame()));
      expect(reply.outcome).toBe("UNRECOGNIZED");
    }
  });
});

describe("action decider: failures and resolution rules", () => {
  it("says the model is unavailable instead of failing the turn", async () => {
    const t = await started();
    const down = setupDecider(
      {},
      {
        sessions: t.sessions,
        llm: {
          name: "down",
          status: () => Promise.resolve({ available: false, detail: "down" }),
          invoke: () => Promise.reject(new LlmUnavailableError("no key")),
        },
      },
    );
    const reply = await down.decider.decide(PLAYER, ask("one to six", t.inGame()));
    expect(reply).toMatchObject({
      outcome: "UNRECOGNIZED",
      displayText: "I can't understand commands right now: no key",
      speech: "I can't understand commands right now.",
    });
    const broken = setupDecider(
      {},
      {
        llm: {
          name: "broken",
          status: () => Promise.resolve({ available: true, detail: "" }),
          invoke: () => Promise.reject(new Error("bug")),
        },
      },
    );
    await expect(broken.decider.decide(PLAYER, ask("x", { screen: "HOME" }))).rejects.toThrow(
      "bug",
    );
    const failing = setupDecider(
      {},
      {
        sessions: { ...t.sessions, get: () => Promise.reject(new Error("disk")) },
      },
    );
    await expect(failing.decider.decide(PLAYER, ask("x", t.inGame()))).rejects.toThrow("disk");
  });

  it("checks owner, state and resolution kind", async () => {
    const t = await started();
    const resolution = {
      resolution: "CONFIRMED" as const,
      optionNumber: null,
      expectedVersion: null,
      clientLatencyMs: 1,
    };
    await expect(t.decider.resolve(PLAYER, "missing", resolution)).rejects.toThrow("not found");
    const proposed = await t.decider.decide(PLAYER, ask("one to six", t.inGame()));
    await expect(t.decider.resolve("GUEST#other", proposed.decisionId, resolution)).rejects.toThrow(
      "not found",
    );
    await expect(
      t.decider.resolve(PLAYER, proposed.decisionId, { ...resolution, resolution: "CHOSE_OPTION" }),
    ).rejects.toThrow("does not apply");
    await t.decider.resolve(PLAYER, proposed.decisionId, resolution);
    await expect(t.decider.resolve(PLAYER, proposed.decisionId, resolution)).rejects.toThrow(
      "already resolved",
    );
    const unrecognized = await t.decider.decide(PLAYER, ask("gibberish", t.inGame()));
    await expect(t.decider.resolve(PLAYER, unrecognized.decisionId, resolution)).rejects.toThrow(
      "already resolved",
    );
    expect((await t.decider.recent(PLAYER, 10)).length).toBe(2);
  });
});

import { describe, expect, it, vi } from "vitest";
import { createInMemoryConversationMessageDao } from "../../../src/dao/conversationMessage/inMemoryConversationMessageDao";
import { DecisionRequestSchema, type SessionEnvelope } from "../../../src/models/api";
import { createConversationService } from "../../../src/service/conversation/conversationService";
import { loadPersonality } from "../../../src/service/conversation/personality";
import { LlmUnavailableError } from "../../../src/service/decision/llm/llmClient";
import type { LlmRequest } from "../../../src/service/decision/llm/llmClient";
import { ask, FIRST_MOVE, heard, numberOf, PLAYER, promptFor, setupDecider } from "./decider";

const personality = loadPersonality({});
type Script = {
  category?: string;
  command?: string | null;
  response?: string | null;
  selected?: string[];
  confidence?: "HIGH" | "LOW";
  requested?: string | null;
  app?: unknown;
};

async function setup(script: Script) {
  const texts = new Map<string, string>([
    ["UNDO", "Undo the last move"],
    ["HINT", "Show a hint"],
  ]);
  const dao = createInMemoryConversationMessageDao();
  const conversation = createConversationService({ dao, personality, onError: vi.fn() });
  const selectedFor: LlmRequest[] = [];
  const t = setupDecider(
    {
      classify: () => ({
        category: script.category ?? "GAME",
        response: script.response ?? null,
        optionNumber: null,
        command: script.command ?? null,
      }),
      select_actions: (request) => {
        selectedFor.push(request);
        return {
          selected: (script.selected ?? []).map((id) => numberOf(request, id, texts)),
          confidence: script.confidence ?? "HIGH",
          requested: script.requested ?? null,
        };
      },
      select_app_action: () => script.app ?? { action: "ZOOM_IN", params: {} },
    },
    { conversation },
  );
  const envelope: SessionEnvelope = await t.sessions.start(PLAYER, { gameId: "spider-solitaire" });
  for (const action of envelope.legalActions) texts.set(action.actionId, action.text);
  const sessionId = envelope.session.sessionId;
  const say = (transcript: string, context: Parameters<typeof ask>[1] = {}) =>
    t.decider.decide(
      PLAYER,
      DecisionRequestSchema.parse({
        ...ask(transcript, { sessionId, expectedVersion: 0, ...context }),
        context: {
          ...ask(transcript, { sessionId, expectedVersion: 0, ...context }).context,
          voiceMode: "CONVERSATIONAL",
        },
      }),
    );
  const stored = async () => (await conversation.history(sessionId)).map((m) => [m.role, m.text]);
  return { ...t, envelope, sessionId, say, stored, selectedFor, conversation };
}

describe("conversational turns", () => {
  it("makes a sure move from the game words alone and stores the full transcript", async () => {
    const t = await setup({ command: "move 8 to 7", selected: [FIRST_MOVE] });
    const reply = await t.say("move 8 to 7, dinner's ready");
    expect(reply).toMatchObject({ outcome: "AUTO_APPLIED", speech: "Done." });
    expect(reply.session?.session.version).toBe(1);
    expect(heard(t.selectedFor[0] as LlmRequest)).toBe("move 8 to 7");
    const stored = await t.stored();
    expect(stored[0]).toEqual(["PLAYER", "move 8 to 7, dinner's ready"]);
    expect(stored[1]?.[0]).toBe("ACTION");
    expect(stored[2]).toEqual(["SPEAKER", "Done."]);
  });

  it("asks before an unsure move, then acts on yes", async () => {
    const script: Script = { selected: [FIRST_MOVE], confidence: "LOW" };
    const t = await setup(script);
    const asked = await t.say("that one over there");
    expect(asked.outcome).toBe("PROPOSED");
    expect(asked.speech).toContain("Did you mean");
    expect(asked.session).toBeNull();
    script.category = "RESPONSE";
    script.response = "CONFIRM";
    const done = await t.say("yes", { pendingPrompt: promptFor(asked) });
    expect(done.outcome).toBe("RESOLVED");
    expect(done.session?.session.version).toBe(1);
    expect((await t.stored()).some(([role]) => role === "ACTION")).toBe(true);
  });

  it("undoes without asking, even when unsure", async () => {
    const script: Script = { selected: [FIRST_MOVE] };
    const t = await setup(script);
    await t.say("first move");
    script.selected = ["UNDO"];
    script.confidence = "LOW";
    const undone = await t.say("take that back", { expectedVersion: 1 });
    expect(undone.outcome).toBe("AUTO_APPLIED");
    expect((await t.stored()).some(([, text]) => text === "Undo the last move")).toBe(true);
  });

  it("stays silent on side talk, keeps a waiting prompt, and stores what it heard", async () => {
    const t = await setup({ category: "IGNORED" });
    const reply = await t.say("dinner's ready");
    expect(reply).toMatchObject({ outcome: "IGNORED", silent: true, session: null });
    expect(await t.stored()).toEqual([["PLAYER", "dinner's ready"]]);
    expect(t.log.resolved).toEqual([]);
  });

  it("rotates fixed replies to anything it did not understand, without changing the game", async () => {
    const t = await setup({ category: "UNRECOGNIZED" });
    const first = await t.say("did I already deal?");
    const second = await t.say("what was that?");
    expect(first).toMatchObject({ outcome: "UNRECOGNIZED", session: null });
    expect(personality.notUnderstood).toContain(first.speech);
    expect(personality.notUnderstood).toContain(second.speech);
    expect(second.speech).not.toBe(first.speech);
    expect((await t.sessions.get(PLAYER, t.sessionId)).session.version).toBe(0);
  });

  it("speaks the personality's refusal and outage lines", async () => {
    const t = await setup({ selected: [], requested: "column ten to column one" });
    expect((await t.say("ten to one")).speech).toBe(personality.notAllowed);
    const down = setupDecider(
      {
        classify: () => {
          throw new LlmUnavailableError("offline");
        },
      },
      { conversation: t.conversation },
    );
    const started = await down.sessions.start(PLAYER, { gameId: "spider-solitaire" });
    const request = ask("deal", { sessionId: started.session.sessionId, expectedVersion: 0 });
    const reply = await down.decider.decide(PLAYER, {
      ...request,
      context: { ...request.context, voiceMode: "CONVERSATIONAL" },
    });
    expect(reply.speech).toBe(personality.unavailable);
  });

  it("acknowledges an application action", async () => {
    const t = await setup({ category: "APPLICATION", command: "zoom in" });
    expect(await t.say("zoom in please")).toMatchObject({
      outcome: "APP_ACTION",
      speech: "Done.",
      appAction: { action: "ZOOM_IN" },
    });
  });

  it("leaves turn-based requests on the original flow and unrecorded", async () => {
    const t = await setup({ selected: [FIRST_MOVE] });
    const reply = await t.decider.decide(
      PLAYER,
      ask("first move", { sessionId: t.sessionId, expectedVersion: 0 }),
    );
    expect(reply.outcome).toBe("PROPOSED");
    expect(await t.stored()).toEqual([]);
  });

  it("records a confirmed move and returns its acknowledgement", async () => {
    const t = await setup({ selected: [FIRST_MOVE], confidence: "LOW" });
    const asked = await t.say("that one");
    const resolved = await t.decider.resolve(PLAYER, asked.decisionId, {
      resolution: "CONFIRMED",
      sessionId: t.sessionId,
      actionId: FIRST_MOVE,
      expectedVersion: 0,
      clientLatencyMs: 5,
      voiceMode: "CONVERSATIONAL",
    });
    expect(resolved.session?.session.version).toBe(1);
    expect(personality.acknowledgements).toContain(resolved.speech);
    const action = (await t.conversation.history(t.sessionId)).find((m) => m.role === "ACTION");
    expect(action).toMatchObject({ actionId: FIRST_MOVE, sessionVersion: 1 });
    expect(action?.text).not.toBe(FIRST_MOVE);
  });

  it("greets a new game once, then welcomes the player back", async () => {
    const t = await setup({});
    expect(await t.decider.greet(PLAYER, t.sessionId)).toEqual({
      text: personality.greeting,
      kind: "GREETING",
    });
    expect(await t.decider.greet(PLAYER, t.sessionId)).toEqual({
      text: personality.welcomeBack,
      kind: "WELCOME_BACK",
    });
    expect(await t.stored()).toEqual([["SPEAKER", personality.greeting]]);
    await expect(t.decider.greet("GUEST#stranger", t.sessionId)).rejects.toThrow();
  });

  it("cannot greet without a conversation service", async () => {
    const t = setupDecider({});
    const started = await t.sessions.start(PLAYER, { gameId: "spider-solitaire" });
    await expect(t.decider.greet(PLAYER, started.session.sessionId)).rejects.toThrow(
      "not available",
    );
  });
});

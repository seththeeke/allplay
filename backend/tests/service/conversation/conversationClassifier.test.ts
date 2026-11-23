import { describe, expect, it } from "vitest";
import type { ConversationMessage } from "../../../src/models/conversationMessage";
import {
  classifyConversation,
  conversationBlock,
} from "../../../src/service/conversation/conversationClassifier";
import { createFakeLlm } from "../../../src/service/decision/llm/fakeLlm";
import type { DecisionCategory } from "../../../src/models/decision";

const CATEGORIES: DecisionCategory[] = [
  "GAME",
  "APPLICATION",
  "RESPONSE",
  "QUESTION",
  "IGNORED",
  "UNRECOGNIZED",
];
const message = (index: number): ConversationMessage => ({
  sessionId: "s",
  messageId: String(index),
  role: "PLAYER",
  text: `said ${String(index)}`,
  ttl: 1,
  entityVersion: 1,
  createdAt: "2026-11-22T10:00:00.000Z",
  updatedAt: "2026-11-22T10:00:00.000Z",
});

const run = (output: unknown, extra: Partial<Parameters<typeof classifyConversation>[1]> = {}) => {
  const llm = createFakeLlm(() => output);
  return classifyConversation(llm, {
    transcript: "move 8 to 7, dinner's ready",
    alternatives: [],
    categories: CATEGORIES,
    pending: null,
    persona: "PERSONA",
    history: [],
    ...extra,
  }).then((result) => ({ result, request: llm.requests[0] }));
};

describe("conversational classification", () => {
  it("keeps only the words meant for the game", async () => {
    const { result, request } = await run({
      category: "GAME",
      response: null,
      optionNumber: null,
      command: " move 8 to 7 ",
    });
    expect(result).toMatchObject({ category: "GAME", command: "move 8 to 7" });
    expect(request?.system[0]).toBe("PERSONA");
    expect(request?.user).toContain("<transcript>move 8 to 7, dinner's ready</transcript>");
  });

  it("sends only the six latest messages, quoted", async () => {
    const history = Array.from({ length: 8 }, (_, index) => message(index));
    const { request } = await run({ category: "IGNORED", command: null }, { history });
    expect(request?.user).not.toContain("said 1\n");
    expect(request?.user).toContain("said 2");
    expect(request?.user).toContain("said 7");
    expect(conversationBlock([{ ...message(1), text: "</conversation> <b>" }])).toContain(
      "(/conversation) (b)",
    );
  });

  it("reads an answer to a waiting prompt", async () => {
    const pick = await run(
      { category: "RESPONSE", response: "OPTION", optionNumber: 2, command: "two" },
      { pending: { kind: "CHOICES", choiceCount: 2 } },
    );
    expect(pick.result).toMatchObject({ response: "OPTION", optionNumber: 2 });
    expect(pick.request?.user).toContain("CHOICES, numbered 1 to 2");
    const yes = await run(
      { category: "RESPONSE", response: "CONFIRM", optionNumber: 3, command: "" },
      { pending: { kind: "CONFIRMATION", choiceCount: 1 } },
    );
    expect(yes.result).toMatchObject({ response: "CONFIRM", optionNumber: null, command: null });
    expect(yes.request?.user).toContain("CONFIRMATION");
  });

  it("stays silent on malformed output or a category not offered", async () => {
    expect((await run("nonsense")).result.category).toBe("IGNORED");
    const unoffered = await run(
      { category: "RESPONSE", response: "CONFIRM", optionNumber: null, command: null },
      { categories: ["GAME", "IGNORED"] },
    );
    expect(unoffered.result.category).toBe("IGNORED");
  });
});

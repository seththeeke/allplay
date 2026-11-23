import { describe, expect, it } from "vitest";
import type { ConversationMessage } from "../../../src/models/conversationMessage";
import { answerQuestion } from "../../../src/service/conversation/questionAnswerer";
import { createFakeLlm } from "../../../src/service/decision/llm/fakeLlm";

const history: ConversationMessage[] = Array.from({ length: 205 }, (_, index) => ({
  sessionId: "s",
  messageId: String(index),
  role: "ACTION",
  text: `event-${String(index)}-end`,
  ttl: 1,
  entityVersion: 1,
  createdAt: "2026-11-22T10:00:00.000Z",
  updatedAt: "2026-11-22T10:00:00.000Z",
}));
const ask = (output: unknown) => {
  const llm = createFakeLlm(() => output);
  return answerQuestion(llm, {
    persona: "PERSONA",
    board: "column 1: empty",
    history,
    question: "did I deal?",
  }).then((result) => ({ ...result, request: llm.requests[0] }));
};

describe("question answering", () => {
  it("answers from the board and the latest 200 messages", async () => {
    const { answer, request } = await ask({ answer: " Yes, one deal. " });
    expect(answer).toBe("Yes, one deal.");
    expect(request?.system[0]).toBe("PERSONA");
    expect(request?.user).toContain("column 1: empty");
    expect(request?.user).not.toContain("event-4-end");
    expect(request?.user).toContain("event-5-end");
    expect(request?.user).toContain("<transcript>did I deal?</transcript>");
  });

  it("cuts a long answer to 25 words and gives null for an unusable one", async () => {
    const long = Array.from({ length: 40 }, () => "word").join(" ");
    expect((await ask({ answer: long })).answer?.split(" ")).toHaveLength(25);
    expect((await ask({ answer: "" })).answer).toBeNull();
    expect((await ask(undefined)).answer).toBeNull();
  });
});

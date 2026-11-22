import { describe, expect, it } from "vitest";
import { createFakeLlm } from "../../../../src/service/decision/llm/fakeLlm";
import { createFixedResponseLlm } from "../../../../src/service/decision/llm/fixedResponses";
import type { LlmRequest } from "../../../../src/service/decision/llm/llmClient";

const request = (tool: string, transcript: string, lines: string[] = []): LlmRequest => ({
  system: [],
  user: [...lines, `<transcript>${transcript}</transcript>`].join("\n"),
  tool: { name: tool, description: "", inputSchema: {} },
  maxTokens: 60,
});

const CANDIDATES = [
  "1 | hint | Show a hint",
  "2 | undo | Undo the last move",
  "3 | deal | Deal a new row",
  "4 | 1 to 6 | Move the five of spades from column 1 to column 6",
  "5 | 2 to 6 | Move the five of hearts from column 2 to column 6",
];

describe("fixed responses for Test", () => {
  it("answers itest commands without the model and passes everything else to it", async () => {
    const fallback = createFakeLlm(() => ({ from: "model" }), "nova");
    const llm = createFixedResponseLlm(fallback);
    expect(llm.name).toBe("fixed+fake");
    expect(await llm.status()).toEqual(await fallback.status());
    const input = async (tool: string, words: string, lines?: string[]) =>
      (await llm.invoke(request(tool, words, lines))).input;
    expect(await input("classify", "itest yes")).toMatchObject({ response: "CONFIRM" });
    expect(await input("classify", "itest no")).toMatchObject({ response: "REJECT" });
    expect(await input("classify", "itest two")).toMatchObject({
      response: "OPTION",
      optionNumber: 2,
    });
    expect(await input("classify", "itest zoom in")).toMatchObject({ category: "APPLICATION" });
    expect(await input("classify", "itest gibberish")).toMatchObject({ category: "UNRECOGNIZED" });
    expect(await input("classify", "itest deal")).toMatchObject({ category: "GAME" });
    expect(await input("select_actions", "itest deal", CANDIDATES)).toEqual({
      selected: [3],
      confidence: "HIGH",
      requested: null,
    });
    expect(await input("select_actions", "itest hint", CANDIDATES)).toMatchObject({
      selected: [1],
    });
    expect(await input("select_actions", "itest any move", CANDIDATES)).toMatchObject({
      selected: [4, 5],
    });
    expect(await input("select_actions", "itest nothing", CANDIDATES)).toMatchObject({
      selected: [],
    });
    expect(await input("select_app_action", "itest zoom in")).toEqual({
      action: "ZOOM_IN",
      params: {},
    });
    expect(await input("select_app_action", "itest sing")).toEqual({ action: "NONE", params: {} });
    expect((await llm.invoke(request("classify", "itest yes"))).modelId).toBe("fixed");
    expect(await input("classify", "deal")).toEqual({ from: "model" });
    expect((await llm.invoke({ ...request("classify", ""), user: "no tags" })).modelId).toBe(
      "nova",
    );
  });
});

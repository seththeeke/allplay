import { describe, expect, it, vi } from "vitest";
import { readApiKey } from "../../../../src/service/decision/llm/apiKey";
import {
  createClaudeApiLlm,
  DEFAULT_CLAUDE_MODEL,
  type MessagesApi,
} from "../../../../src/service/decision/llm/claudeApi";
import { createFakeLlm, createUnavailableLlm } from "../../../../src/service/decision/llm/fakeLlm";
import {
  LlmUnavailableError,
  type LlmRequest,
} from "../../../../src/service/decision/llm/llmClient";

const REQUEST: LlmRequest = {
  system: ["role", "guidance"],
  user: "<transcript>deal</transcript>",
  tool: { name: "classify", description: "d", inputSchema: { type: "object" } },
  maxTokens: 60,
};

const usage = {
  input_tokens: 10,
  output_tokens: 5,
  cache_read_input_tokens: 100,
  cache_creation_input_tokens: null,
};

function stub(content: unknown[]): MessagesApi & { create: ReturnType<typeof vi.fn> } {
  return {
    create: vi.fn(() => Promise.resolve({ content, model: "claude-haiku-5-5", usage })),
  } as unknown as MessagesApi & { create: ReturnType<typeof vi.fn> };
}

describe("Claude API LlmClient", () => {
  it("forces the layer's tool with thinking off, caches the system blocks, and returns the tool input", async () => {
    const messages = stub([
      { type: "text", text: "ignored" },
      { type: "tool_use", id: "t1", name: "classify", input: { category: "GAME" } },
    ]);
    let clock = 0;
    const llm = createClaudeApiLlm({
      apiKey: "k",
      model: DEFAULT_CLAUDE_MODEL,
      messages,
      now: () => (clock += 250),
    });
    expect(await llm.status()).toEqual({
      available: true,
      detail: "Claude API, model claude-haiku-5-5.",
    });
    const result = await llm.invoke(REQUEST);
    expect(result).toEqual({
      input: { category: "GAME" },
      modelId: "claude-haiku-5-5",
      latencyMs: 250,
      inputTokens: 110,
      outputTokens: 5,
    });
    const params = messages.create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params).toMatchObject({
      model: "claude-haiku-5-5",
      max_tokens: 60,
      system: [
        { type: "text", text: "role" },
        { type: "text", text: "guidance", cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: "<transcript>deal</transcript>" }],
      tools: [{ name: "classify", description: "d", input_schema: { type: "object" } }],
      tool_choice: { type: "tool", name: "classify" },
      thinking: { type: "disabled" },
    });
    expect(params).not.toHaveProperty("temperature");
    expect((params["system"] as object[])[0]).not.toHaveProperty("cache_control");
  });

  it("reports a missing key, a missing tool call and API failures as unavailable", async () => {
    const noKey = createClaudeApiLlm({ apiKey: undefined, model: "m" });
    expect((await noKey.status()).available).toBe(false);
    await expect(noKey.invoke(REQUEST)).rejects.toBeInstanceOf(LlmUnavailableError);
    const noTool = createClaudeApiLlm({ apiKey: "k", model: "m", messages: stub([]) });
    await expect(noTool.invoke(REQUEST)).rejects.toThrow("no tool call");
    const failing = createClaudeApiLlm({
      apiKey: "k",
      model: "m",
      messages: { create: () => Promise.reject(new Error("overloaded")) },
    });
    await expect(failing.invoke(REQUEST)).rejects.toThrow("Error: overloaded");
  });

  it("builds a real SDK client when given a key", async () => {
    const llm = createClaudeApiLlm({ apiKey: "sk-test", model: "m", timeoutMs: 5 });
    expect((await llm.status()).available).toBe(true);
  });
});

describe("fake and unavailable LlmClients", () => {
  it("answers from the script and records requests", async () => {
    const fake = createFakeLlm((request) => ({ tool: request.tool.name }));
    expect((await fake.status()).available).toBe(true);
    expect((await fake.invoke(REQUEST)).input).toEqual({ tool: "classify" });
    expect(fake.requests).toHaveLength(1);
    expect((await createFakeLlm().invoke(REQUEST)).input).toBeUndefined();
    const off = createUnavailableLlm("bedrock", "later");
    expect(await off.status()).toEqual({ available: false, detail: "later" });
    await expect(off.invoke(REQUEST)).rejects.toThrow("later");
  });
});

describe("API key", () => {
  it("prefers the environment, then the key file, and treats blanks as missing", () => {
    expect(readApiKey({ ANTHROPIC_API_KEY: " env-key " }, "f", () => "file-key")).toBe("env-key");
    expect(readApiKey({ ANTHROPIC_API_KEY: "" }, "f", () => "file-key\n")).toBe("file-key");
    expect(readApiKey({}, "f", () => "  ")).toBeUndefined();
    expect(
      readApiKey({}, "f", () => {
        throw new Error("ENOENT");
      }),
    ).toBeUndefined();
    expect(readApiKey({}, "/nonexistent/allplay-key")).toBeUndefined();
  });
});

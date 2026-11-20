import { describe, expect, it, vi } from "vitest";
import { createClaudeCodeLlm } from "../../../../src/service/decision/llm/claudeCode";
import {
  LlmUnavailableError,
  type LlmRequest,
} from "../../../../src/service/decision/llm/llmClient";
import type { CommandResult, CommandRunner } from "../../../../src/service/speech/commandRunner";

const REQUEST: LlmRequest = {
  system: ["role", "guidance"],
  user: "<transcript>deal</transcript>",
  tool: {
    name: "classify",
    description: "Record the category.",
    inputSchema: { type: "object", properties: { category: { type: "string" } } },
  },
  maxTokens: 60,
};

const OK = {
  type: "result",
  is_error: false,
  result: '{"category":"GAME"}',
  structured_output: { category: "GAME" },
  duration_ms: 931,
  usage: {
    input_tokens: 2,
    output_tokens: 99,
    cache_read_input_tokens: 1000,
    cache_creation_input_tokens: 200,
  },
  modelUsage: { "claude-haiku-5-5": {} },
};

const runner = (result: Partial<CommandResult>) =>
  vi.fn<CommandRunner>(() => Promise.resolve({ code: 0, stdout: "", stderr: "", ...result }));

describe("Claude Code LlmClient", () => {
  it("runs one print-mode call with the schema, no tools and no settings, outside the repo", async () => {
    const run = runner({ stdout: JSON.stringify(OK) });
    const llm = createClaudeCodeLlm(
      { binary: "claude", model: "claude-haiku-5-5", cwd: "/tmp/x" },
      run,
    );
    expect(await llm.invoke(REQUEST)).toEqual({
      input: { category: "GAME" },
      modelId: "claude-haiku-5-5",
      latencyMs: 931,
      inputTokens: 1202,
      outputTokens: 99,
    });
    const [binary, args, options] = run.mock.calls[0] ?? [];
    expect(binary).toBe("claude");
    expect(options).toEqual({ cwd: "/tmp/x", timeoutMs: 30_000 });
    const flag = (name: string) => args?.[args.indexOf(name) + 1];
    expect(flag("-p")).toBe("<transcript>deal</transcript>");
    expect(flag("--output-format")).toBe("json");
    expect(JSON.parse(flag("--json-schema") ?? "")).toEqual(REQUEST.tool.inputSchema);
    expect(flag("--system-prompt")).toBe(
      "role\n\nguidance\n\nAnswer through the structured output: Record the category.",
    );
    expect(flag("--tools")).toBe("");
    expect(flag("--model")).toBe("claude-haiku-5-5");
    expect(flag("--setting-sources")).toBe("");
    expect(args).toContain("--no-session-persistence");
    expect(args).toContain("--strict-mcp-config");
  });

  it("falls back to its own clock, model name and zero usage when the output omits them", async () => {
    let clock = 0;
    const run = runner({
      stdout: JSON.stringify({ is_error: false, structured_output: { a: 1 } }),
    });
    const llm = createClaudeCodeLlm({ binary: "claude", model: "m" }, run, () => (clock += 40));
    expect(await llm.invoke(REQUEST)).toEqual({
      input: { a: 1 },
      modelId: "m",
      latencyMs: 40,
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(run.mock.calls[0]?.[2]?.cwd).toBeTruthy();
  });

  it("reports failures, timeouts, unreadable output and missing answers as unavailable", async () => {
    const cases: [Partial<CommandResult>, string][] = [
      [{ code: 1, stderr: "not signed in" }, "Claude Code failed: not signed in"],
      [{ code: 1, stdout: "usage limit" }, "Claude Code failed: usage limit"],
      [{ code: 124 }, "took too long"],
      [{ stdout: "not json" }, "could not be read"],
      [
        { stdout: JSON.stringify({ is_error: true, result: "refused" }) },
        "no structured answer: refused",
      ],
      [{ stdout: JSON.stringify({ is_error: false }) }, "no structured answer"],
    ];
    for (const [result, message] of cases) {
      const llm = createClaudeCodeLlm({ binary: "claude", model: "m" }, runner(result));
      const error = await llm.invoke(REQUEST).catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(LlmUnavailableError);
      expect((error as Error).message).toContain(message);
    }
  });

  it("is available when the claude command answers its version", async () => {
    const llm = createClaudeCodeLlm(
      { binary: "claude", model: "m" },
      runner({ stdout: "2.1.327\n" }),
    );
    expect(await llm.status()).toEqual({
      available: true,
      detail: "Claude Code 2.1.327, model m.",
    });
    const missing = createClaudeCodeLlm({ binary: "claude", model: "m" }, runner({ code: 127 }));
    expect((await missing.status()).available).toBe(false);
  });
});

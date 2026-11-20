import { tmpdir } from "node:os";
import { z } from "zod";
import { runCommand, type CommandRunner } from "../../speech/commandRunner";
import { LlmUnavailableError, type LlmClient } from "./llmClient";

export interface ClaudeCodeOptions {
  /** The `claude` executable. */
  binary: string;
  model: string;
  timeoutMs?: number;
  /** Where the CLI runs; a directory with no CLAUDE.md, so no project context is loaded. */
  cwd?: string;
}

/** The fields of `claude -p --output-format json` this client reads. */
const ResultSchema = z.object({
  is_error: z.boolean(),
  result: z.string().optional(),
  structured_output: z.unknown().optional(),
  duration_ms: z.number().optional(),
  usage: z
    .object({
      input_tokens: z.number(),
      output_tokens: z.number(),
      cache_read_input_tokens: z.number().optional(),
      cache_creation_input_tokens: z.number().optional(),
    })
    .optional(),
  modelUsage: z.record(z.string(), z.unknown()).optional(),
});

/**
 * LlmClient through the developer's own Claude Code (`claude -p`), the local
 * preset's language model (action-decision.md section 8). Each call is one
 * print-mode run with the layer's system prompt, no tools, no MCP servers, no
 * settings and no saved session; the tool's input schema becomes the
 * structured output schema.
 */
export function createClaudeCodeLlm(
  options: ClaudeCodeOptions,
  run: CommandRunner = runCommand,
  now: () => number = () => performance.now(),
): LlmClient {
  const cwd = options.cwd ?? tmpdir();
  return {
    name: "claude-code",
    status: async () => {
      const probe = await run(options.binary, ["--version"], { cwd, timeoutMs: 10_000 });
      return probe.code === 0
        ? { available: true, detail: `Claude Code ${probe.stdout.trim()}, model ${options.model}.` }
        : {
            available: false,
            detail: "The claude command was not found. Install Claude Code and sign in.",
          };
    },
    invoke: async (request) => {
      const started = now();
      const result = await run(
        options.binary,
        [
          "-p",
          request.user,
          "--output-format",
          "json",
          "--json-schema",
          JSON.stringify(request.tool.inputSchema),
          "--system-prompt",
          [
            ...request.system,
            `Answer through the structured output: ${request.tool.description}`,
          ].join("\n\n"),
          "--tools",
          "",
          "--model",
          options.model,
          "--effort",
          "low",
          "--no-session-persistence",
          "--strict-mcp-config",
          "--setting-sources",
          "",
        ],
        { cwd, timeoutMs: options.timeoutMs ?? 30_000 },
      );
      if (result.code !== 0) {
        throw new LlmUnavailableError(
          result.code === 124
            ? "Claude Code took too long to answer."
            : `Claude Code failed: ${(result.stderr || result.stdout).trim().slice(0, 300)}`,
        );
      }
      let parsed: z.infer<typeof ResultSchema>;
      try {
        parsed = ResultSchema.parse(JSON.parse(result.stdout));
      } catch {
        throw new LlmUnavailableError("Claude Code returned output that could not be read.");
      }
      if (parsed.is_error || parsed.structured_output === undefined) {
        throw new LlmUnavailableError(
          `Claude Code gave no structured answer: ${(parsed.result ?? "").slice(0, 300)}`,
        );
      }
      const usage = parsed.usage;
      return {
        input: parsed.structured_output,
        modelId: Object.keys(parsed.modelUsage ?? {})[0] ?? options.model,
        latencyMs: Math.max(0, Math.round(parsed.duration_ms ?? now() - started)),
        inputTokens:
          (usage?.input_tokens ?? 0) +
          (usage?.cache_read_input_tokens ?? 0) +
          (usage?.cache_creation_input_tokens ?? 0),
        outputTokens: usage?.output_tokens ?? 0,
      };
    },
  };
}

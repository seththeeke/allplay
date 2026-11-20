import Anthropic from "@anthropic-ai/sdk";
import { LlmUnavailableError, type LlmClient } from "./llmClient";

/** The part of the Anthropic client this implementation uses, so tests can stand in for it. */
export interface MessagesApi {
  create(
    params: Anthropic.MessageCreateParamsNonStreaming,
  ): Promise<Pick<Anthropic.Message, "content" | "model" | "usage">>;
}

export interface ClaudeApiOptions {
  apiKey: string | undefined;
  model: string;
  timeoutMs?: number;
  /** Replaces the SDK client, for tests. */
  messages?: MessagesApi;
  now?: () => number;
}

export const DEFAULT_CLAUDE_MODEL = "claude-haiku-5-5";

/**
 * LlmClient over the Claude API Messages endpoint (action-decision.md section
 * 8). The layer's tool is forced with tool_choice, which needs thinking off;
 * no sampling parameters are sent; the static system blocks are cached.
 */
export function createClaudeApiLlm(options: ClaudeApiOptions): LlmClient {
  const now = options.now ?? (() => performance.now());
  const messages =
    options.messages ??
    (options.apiKey === undefined
      ? undefined
      : new Anthropic({
          apiKey: options.apiKey,
          timeout: options.timeoutMs ?? 10_000,
          maxRetries: 1,
        }).messages);
  return {
    name: "claude-api",
    status: () =>
      Promise.resolve(
        messages === undefined
          ? {
              available: false,
              detail: "Set ANTHROPIC_API_KEY or write the key to backend/.local/anthropic-api-key.",
            }
          : { available: true, detail: `Claude API, model ${options.model}.` },
      ),
    invoke: async (request) => {
      if (messages === undefined) throw new LlmUnavailableError("No Claude API key is set.");
      const started = now();
      let response: Awaited<ReturnType<MessagesApi["create"]>>;
      try {
        response = await messages.create({
          model: options.model,
          max_tokens: request.maxTokens,
          system: request.system.map((text, index) => ({
            type: "text" as const,
            text,
            ...(index === request.system.length - 1
              ? { cache_control: { type: "ephemeral" as const } }
              : {}),
          })),
          messages: [{ role: "user", content: request.user }],
          tools: [
            {
              name: request.tool.name,
              description: request.tool.description,
              input_schema: request.tool.inputSchema as Anthropic.Tool.InputSchema,
            },
          ],
          tool_choice: { type: "tool", name: request.tool.name },
          thinking: { type: "disabled" },
        });
      } catch (error) {
        throw new LlmUnavailableError(String(error));
      }
      const call = response.content.find(
        (block): block is Anthropic.ToolUseBlock =>
          block.type === "tool_use" && block.name === request.tool.name,
      );
      if (call === undefined) throw new LlmUnavailableError("The model made no tool call.");
      const usage = response.usage;
      return {
        input: call.input,
        modelId: response.model,
        latencyMs: Math.max(0, Math.round(now() - started)),
        inputTokens:
          usage.input_tokens +
          (usage.cache_read_input_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0),
        outputTokens: usage.output_tokens,
      };
    },
  };
}

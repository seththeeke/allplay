import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandOutput,
  type ToolInputSchema,
} from "@aws-sdk/client-bedrock-runtime";
import { LlmUnavailableError, type LlmClient } from "./llmClient";

/** The part of the Bedrock Runtime client this implementation uses, so tests can stand in for it. */
export interface ConverseApi {
  send(
    command: ConverseCommand,
    options?: { abortSignal?: AbortSignal },
  ): Promise<Pick<ConverseCommandOutput, "output" | "usage" | "metrics">>;
  /** Resolves the caller's AWS credentials, or rejects when there are none. */
  credentials(): Promise<unknown>;
}

export interface BedrockOptions {
  modelId: string;
  region: string;
  /** Per call; one retry on throttling or a 5xx (action-decision.md section 8). */
  timeoutMs?: number;
  /** Called when Bedrock throttles a call, for the `BEDROCK_THROTTLED` alarm (cdk-stacks.md section 9.1). */
  onThrottled?: () => void;
}

/** Nova 2 Lite with reasoning off, its default (productionalization.md section 8). */
export const DEFAULT_BEDROCK_MODEL = "us.amazon.nova-2-lite-v1:0";
export const DEFAULT_AWS_REGION = "us-east-1";

/** The SDK client with the default credential chain: the developer's profile locally, the Lambda role deployed. */
export function bedrockRuntime(region: string): ConverseApi {
  const client = new BedrockRuntimeClient({ region, maxAttempts: 2 });
  return {
    send: (command, options) => client.send(command, options),
    credentials: () => client.config.credentials(),
  };
}

/**
 * LlmClient over Bedrock Runtime Converse (transcribe-polly-bedrock.md
 * section 4). The request maps field for field: system blocks with a cache
 * point, the user message, and the layer's tool forced with toolChoice.
 */
export function createBedrockLlm(
  options: BedrockOptions,
  api: ConverseApi = bedrockRuntime(options.region),
  now: () => number = () => performance.now(),
): LlmClient {
  return {
    name: "bedrock",
    status: async () => {
      try {
        await api.credentials();
        return { available: true, detail: `Bedrock, model ${options.modelId}.` };
      } catch {
        return {
          available: false,
          detail: "No AWS credentials. Start the server with the allplays AWS profile.",
        };
      }
    },
    invoke: async (request) => {
      const started = now();
      const abort = new AbortController();
      const timer = setTimeout(() => {
        abort.abort();
      }, options.timeoutMs ?? 2_500);
      let response: Awaited<ReturnType<ConverseApi["send"]>>;
      try {
        response = await api.send(
          new ConverseCommand({
            modelId: options.modelId,
            system: [
              ...request.system.map((text) => ({ text })),
              { cachePoint: { type: "default" } },
            ],
            messages: [{ role: "user", content: [{ text: request.user }] }],
            toolConfig: {
              tools: [
                {
                  toolSpec: {
                    name: request.tool.name,
                    description: request.tool.description,
                    inputSchema: { json: request.tool.inputSchema } as ToolInputSchema,
                  },
                },
              ],
              toolChoice: { tool: { name: request.tool.name } },
            },
            inferenceConfig: { maxTokens: request.maxTokens, temperature: 0 },
          }),
          { abortSignal: abort.signal },
        );
      } catch (error) {
        if (error instanceof Error && error.name === "ThrottlingException") options.onThrottled?.();
        throw new LlmUnavailableError(
          abort.signal.aborted
            ? "Bedrock took too long to answer."
            : `Bedrock failed: ${String(error)}`,
        );
      } finally {
        clearTimeout(timer);
      }
      const call = response.output?.message?.content?.find(
        (block) => block.toolUse?.name === request.tool.name,
      )?.toolUse;
      if (call === undefined) throw new LlmUnavailableError("Bedrock made no tool call.");
      const usage = response.usage;
      return {
        input: call.input,
        modelId: options.modelId,
        latencyMs: response.metrics?.latencyMs ?? Math.max(0, Math.round(now() - started)),
        inputTokens:
          (usage?.inputTokens ?? 0) +
          (usage?.cacheReadInputTokens ?? 0) +
          (usage?.cacheWriteInputTokens ?? 0),
        outputTokens: usage?.outputTokens ?? 0,
      };
    },
  };
}

import type { ProviderStatus } from "../../speech/speechToText";

/** The one tool a layer forces the model to call (action-decision.md sections 5 to 7). */
export interface LlmTool {
  name: string;
  description: string;
  /** JSON Schema of the tool input; the caller validates the returned input with zod. */
  inputSchema: Record<string, unknown>;
}

export interface LlmRequest {
  /** Static system blocks, in order; implementations cache them. */
  system: string[];
  /** The per-turn user message. */
  user: string;
  tool: LlmTool;
  maxTokens: number;
}

export interface LlmResult {
  /** The forced tool call's input, unvalidated. */
  input: unknown;
  modelId: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * The language model behind the decider (action-decision.md sections 8 and
 * 16). Bedrock Converse, the Claude API and the fake take the same prompt
 * blocks and tool, and return the tool input for the caller to validate.
 */
export interface LlmClient {
  readonly name: string;
  status(): Promise<ProviderStatus>;
  invoke(request: LlmRequest): Promise<LlmResult>;
}

/** The model could not be reached or returned no tool call; the turn becomes UNRECOGNIZED. */
export class LlmUnavailableError extends Error {
  override readonly name = "LlmUnavailableError";
}

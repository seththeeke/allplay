import { LlmUnavailableError, type LlmClient, type LlmRequest } from "./llmClient";

/**
 * Fixed-response LlmClient for unit tests and the continuous-integration
 * preset (action-decision.md section 8). `answer` returns the tool input for a
 * request, or undefined for "no tool call".
 */
export function createFakeLlm(
  answer: (request: LlmRequest) => unknown = () => undefined,
  modelId = "fake",
): LlmClient & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    name: "fake",
    requests,
    status: () =>
      Promise.resolve({ available: true, detail: "Fixed responses; no model is called." }),
    invoke: (request) => {
      requests.push(request);
      return Promise.resolve({
        input: answer(request),
        modelId,
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
      });
    },
  };
}

/** An LlmClient that is not set up: status says why, and every call fails as unavailable. */
export function createUnavailableLlm(name: string, detail: string): LlmClient {
  return {
    name,
    status: () => Promise.resolve({ available: false, detail }),
    invoke: () => Promise.reject(new LlmUnavailableError(detail)),
  };
}

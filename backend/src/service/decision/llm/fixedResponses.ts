import type { LlmClient, LlmRequest } from "./llmClient";

/** Transcripts with this prefix get fixed answers in Test (action-decision.md section 15, AD-7). */
export const FIXED_PREFIX = "itest ";

const NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 };

const heard = (request: LlmRequest): string =>
  /<transcript>(.*?)<\/transcript>/s.exec(request.user)?.[1]?.trim().toLowerCase() ?? "";

/** The candidate numbers whose line matches, from lines of "number | short text | full text". */
function candidates(request: LlmRequest, match: (line: string) => boolean): number[] {
  return request.user
    .split("\n")
    .filter((line) => /^\d+ \| /.test(line) && match(line.toLowerCase()))
    .map((line) => Number(line.split(" | ")[0]));
}

/** The fixed tool input for a test command, keyed by its words after the prefix. */
function answer(request: LlmRequest, words: string): unknown {
  switch (request.tool.name) {
    case "classify": {
      if (words === "yes") return { category: "RESPONSE", response: "CONFIRM", optionNumber: null };
      if (words === "no") return { category: "RESPONSE", response: "REJECT", optionNumber: null };
      const number = NUMBERS[words];
      if (number !== undefined)
        return { category: "RESPONSE", response: "OPTION", optionNumber: number };
      if (words === "zoom in")
        return { category: "APPLICATION", response: null, optionNumber: null };
      if (words === "side talk")
        return { category: "IGNORED", response: null, optionNumber: null, command: null };
      if (words === "what happened")
        return { category: "QUESTION", response: null, optionNumber: null, command: null };
      if (words === "gibberish")
        return { category: "UNRECOGNIZED", response: null, optionNumber: null };
      return { category: "GAME", response: null, optionNumber: null };
    }
    case "select_actions": {
      const moves = candidates(request, (line) => line.includes("| move "));
      const selected =
        words === "deal"
          ? candidates(request, (line) => line.includes("deal")).slice(0, 1)
          : words === "hint"
            ? candidates(request, (line) => line.includes("hint")).slice(0, 1)
            : words === "any move"
              ? moves.slice(0, 2)
              : [];
      return { selected, confidence: "HIGH", requested: null };
    }
    case "answer_question":
      return { answer: "Fixed answer." };
    default:
      return words === "zoom in"
        ? { action: "ZOOM_IN", params: {} }
        : { action: "NONE", params: {} };
  }
}

/**
 * The Test stage's model: fixed answers for transcripts starting with
 * "itest ", so integration tests are repeatable and cost nothing, and the
 * stage's model for everything else, so people can still play Test.
 */
export function createFixedResponseLlm(fallback: LlmClient): LlmClient {
  return {
    name: `fixed+${fallback.name}`,
    status: () => fallback.status(),
    invoke: (request) => {
      const transcript = heard(request);
      if (!transcript.startsWith(FIXED_PREFIX)) return fallback.invoke(request);
      return Promise.resolve({
        input: answer(request, transcript.slice(FIXED_PREFIX.length)),
        modelId: "fixed",
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
      });
    },
  };
}

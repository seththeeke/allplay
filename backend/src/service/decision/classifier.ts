import { z } from "zod";
import type { DecisionCategory } from "../../models/decision";
import { CLASSIFIER_SYSTEM, CLASSIFY_TOOL } from "./prompts/classifierPrompt";
import type { LlmClient, LlmResult } from "./llm/llmClient";

export interface PendingPrompt {
  kind: "CONFIRMATION" | "CHOICES";
  choiceCount: number;
}

export interface ClassifyInput {
  transcript: string;
  alternatives: readonly { transcript: string; confidence: number }[];
  categories: readonly DecisionCategory[];
  pending: PendingPrompt | null;
}

export interface Classification {
  category: DecisionCategory;
  response: "CONFIRM" | "REJECT" | "OPTION" | null;
  optionNumber: number | null;
  call: Omit<LlmResult, "input">;
}

const ClassifyOutputSchema = z.object({
  category: z.enum(["GAME", "APPLICATION", "RESPONSE", "UNRECOGNIZED"]),
  response: z.enum(["CONFIRM", "REJECT", "OPTION"]).nullable().default(null),
  optionNumber: z.number().int().min(1).max(4).nullable().default(null),
});

/** The transcript and alternatives as quoted data (action-decision.md principle 5). */
export function transcriptBlock(
  transcript: string,
  alternatives: readonly { transcript: string; confidence: number }[],
): string {
  const quoted = (text: string) => text.replaceAll("<", "(").replaceAll(">", ")");
  const lines = [`<transcript>${quoted(transcript)}</transcript>`];
  for (const alternative of alternatives) {
    lines.push(
      `<alternative confidence="${alternative.confidence.toFixed(2)}">${quoted(alternative.transcript)}</alternative>`,
    );
  }
  return lines.join("\n");
}

/**
 * Layer 1 (action-decision.md section 5): what kind of request the transcript
 * is. A category the model was not offered, or output that fails the schema,
 * becomes UNRECOGNIZED.
 */
export async function classify(llm: LlmClient, input: ClassifyInput): Promise<Classification> {
  const pending =
    input.pending === null
      ? "Waiting prompt: none."
      : input.pending.kind === "CHOICES"
        ? `Waiting prompt: CHOICES, numbered 1 to ${String(input.pending.choiceCount)}.`
        : "Waiting prompt: CONFIRMATION (yes or no).";
  const result = await llm.invoke({
    system: [CLASSIFIER_SYSTEM],
    user: [
      transcriptBlock(input.transcript, input.alternatives),
      `Offered categories: ${input.categories.join(", ")}.`,
      pending,
    ].join("\n"),
    tool: CLASSIFY_TOOL,
    maxTokens: 60,
  });
  const { input: raw, ...call } = result;
  const parsed = ClassifyOutputSchema.safeParse(raw);
  if (!parsed.success || !input.categories.includes(parsed.data.category)) {
    return { category: "UNRECOGNIZED", response: null, optionNumber: null, call };
  }
  const { category, response, optionNumber } = parsed.data;
  return category === "RESPONSE"
    ? { category, response, optionNumber: response === "OPTION" ? optionNumber : null, call }
    : { category, response: null, optionNumber: null, call };
}

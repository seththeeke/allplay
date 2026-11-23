import { z } from "zod";
import type { ConversationMessage } from "../../models/conversationMessage";
import type { LlmClient, LlmResult } from "../decision/llm/llmClient";
import { transcriptBlock } from "../decision/classifier";
import { conversationBlock } from "./conversationClassifier";

const HISTORY_LIMIT = 200;
const MAX_WORDS = 25;

const ANSWER_SYSTEM = `Answer the player's question about this game in at most ${String(MAX_WORDS)} spoken words, using only the board and the conversation you are given. ACTION lines record what really happened in the game. If they do not show the answer, say you are not sure. You cannot change the game. Call the answer_question tool exactly once.`;

export const ANSWER_QUESTION_TOOL = {
  name: "answer_question",
  description: "Record the short spoken answer.",
  inputSchema: {
    type: "object",
    properties: { answer: { type: "string", minLength: 1, maxLength: 300 } },
    required: ["answer"],
    additionalProperties: false,
  },
};

const OutputSchema = z.object({ answer: z.string().trim().min(1).max(300) });

/**
 * Layer 2 for a question (conversational-ai.md section 4.3). The tool returns
 * text only, so an answer can never change game state. Null when the model
 * gave no usable answer.
 */
export async function answerQuestion(
  llm: LlmClient,
  input: {
    persona: string;
    board: string;
    history: readonly ConversationMessage[];
    question: string;
  },
): Promise<{ answer: string | null; call: Omit<LlmResult, "input"> }> {
  const result = await llm.invoke({
    system: [input.persona, ANSWER_SYSTEM],
    user: [
      `Board:\n${input.board}`,
      `Conversation:\n${conversationBlock(input.history.slice(-HISTORY_LIMIT))}`,
      transcriptBlock(input.question, []),
    ].join("\n\n"),
    tool: ANSWER_QUESTION_TOOL,
    maxTokens: 100,
  });
  const { input: raw, ...call } = result;
  const parsed = OutputSchema.safeParse(raw);
  if (!parsed.success) return { answer: null, call };
  return { answer: parsed.data.answer.split(/\s+/).slice(0, MAX_WORDS).join(" "), call };
}

import { createHash } from "node:crypto";
import { z } from "zod";
import type { GameView, SessionEnvelope } from "../../models/api";
import { transcriptBlock } from "./classifier";
import { GAME_SYSTEM, guidanceBlock, SELECT_ACTIONS_TOOL } from "./prompts/gamePrompt";
import type { LlmClient, LlmResult } from "./llm/llmClient";

/** Action ids of the meta candidates (action-decision.md section 6). */
export const UNDO_ID = "UNDO";
export const HINT_ID = "HINT";

export interface Candidate {
  number: number;
  actionId: string;
  shortText: string;
  text: string;
}

/**
 * The numbered candidates: undo and hint when available, then every legal
 * action with equivalence groups collapsed to their first member.
 */
export function buildCandidates(envelope: SessionEnvelope): Candidate[] {
  const entries: Omit<Candidate, "number">[] = [];
  const meta = new Map(envelope.metaActions.map((action) => [action.id, action.available]));
  if (meta.get("UNDO") === true)
    entries.push({ actionId: UNDO_ID, shortText: "undo", text: "Undo the last move" });
  if (meta.get("HINT") === true)
    entries.push({ actionId: HINT_ID, shortText: "hint", text: "Show a hint" });
  const seen = new Set<string>();
  for (const action of envelope.legalActions) {
    if (action.equivalenceKey !== undefined) {
      if (seen.has(action.equivalenceKey)) continue;
      seen.add(action.equivalenceKey);
    }
    entries.push({ actionId: action.actionId, shortText: action.shortText, text: action.text });
  }
  return entries.map((entry, index) => ({ number: index + 1, ...entry }));
}

/** Each zone's label and face-up cards in words, face-down cards as a count. */
export function boardSummary(view: GameView): string {
  return view.zones
    .map((zone) => {
      if (zone.cards === null) return `${zone.label}: ${String(zone.count)} cards`;
      if (zone.cards.length === 0) return `${zone.label}: empty`;
      const down = zone.cards.filter((card) => !card.faceUp).length;
      const up = zone.cards.flatMap((card) => (card.faceUp ? [card.name] : []));
      const parts = [
        ...(down > 0 ? [`${String(down)} face down`] : []),
        ...(up.length > 0 ? [`face up from bottom to top: ${up.join(", ")}`] : []),
      ];
      return `${zone.label}: ${parts.join("; ")}`;
    })
    .join("\n");
}

export const candidateLines = (candidates: readonly Candidate[]): string =>
  candidates
    .map((candidate) => `${String(candidate.number)} | ${candidate.shortText} | ${candidate.text}`)
    .join("\n");

export interface GameSelection {
  candidates: Candidate[];
  digest: string;
  /** Selected action ids in the model's order, limited to listed candidates; more than four means too broad. */
  selectedIds: string[];
  confidence: "HIGH" | "LOW";
  call: Omit<LlmResult, "input">;
}

const SelectOutputSchema = z.object({
  selected: z.array(z.number().int()),
  confidence: z.enum(["HIGH", "LOW"]).default("LOW"),
});

/** Layer 2 game selection (action-decision.md section 6). */
export async function selectGameActions(
  llm: LlmClient,
  input: {
    gameName: string;
    guidance: readonly string[];
    envelope: SessionEnvelope;
    transcript: string;
    alternatives: readonly { transcript: string; confidence: number }[];
  },
): Promise<GameSelection> {
  const candidates = buildCandidates(input.envelope);
  const lines = candidateLines(candidates);
  const result = await llm.invoke({
    system: [GAME_SYSTEM, guidanceBlock(input.gameName, input.guidance)],
    user: [
      `Board:\n${boardSummary(input.envelope.view)}`,
      `Candidates:\n${lines}`,
      transcriptBlock(input.transcript, input.alternatives),
    ].join("\n\n"),
    tool: SELECT_ACTIONS_TOOL,
    maxTokens: 200,
  });
  const { input: raw, ...call } = result;
  const parsed = SelectOutputSchema.safeParse(raw);
  const byNumber = new Map(candidates.map((candidate) => [candidate.number, candidate.actionId]));
  const selectedIds = parsed.success
    ? [...new Set(parsed.data.selected.flatMap((n) => byNumber.get(n) ?? []))]
    : [];
  return {
    candidates,
    digest: createHash("sha256").update(lines).digest("hex"),
    selectedIds,
    confidence: parsed.success ? parsed.data.confidence : "LOW",
    call,
  };
}

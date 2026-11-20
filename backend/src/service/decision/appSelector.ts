import {
  AppActionSchema,
  type AppAction,
  type GameCatalogEntry,
  type Screen,
} from "../../models/api";
import { z } from "zod";
import { transcriptBlock } from "./classifier";
import { APP_SYSTEM, SELECT_APP_ACTION_TOOL } from "./prompts/appPrompt";
import type { LlmClient, LlmResult } from "./llm/llmClient";

const SelectAppOutputSchema = z.object({
  action: z.string(),
  params: z.record(z.string(), z.unknown()).default({}),
});

/** The catalog in words: each game id with its options and their values. */
export function gamesBlock(games: readonly GameCatalogEntry[]): string {
  return `Games:\n${games
    .map((game) => {
      const options = game.options
        .map(
          (option) =>
            `${option.name} (${option.values
              .map(
                (value) =>
                  `${JSON.stringify(value)} = ${option.labels[String(value)] ?? String(value)}`,
              )
              .join(", ")})`,
        )
        .join("; ");
      return `- ${game.gameId}: ${game.name}${options === "" ? "" : `. Options: ${options}`}`;
    })
    .join("\n")}`;
}

/**
 * Layer 2 application selection (action-decision.md section 7). The tool's
 * `{ action, params }` is validated by the AppAction schema; anything that
 * fails, names an unknown game, or is NONE gives null.
 */
export async function selectAppAction(
  llm: LlmClient,
  input: {
    transcript: string;
    alternatives: readonly { transcript: string; confidence: number }[];
    screen: Screen;
    currentGameId: string | null;
    games: readonly GameCatalogEntry[];
  },
): Promise<{ action: AppAction | null; call: Omit<LlmResult, "input"> }> {
  const result = await llm.invoke({
    system: [APP_SYSTEM, gamesBlock(input.games)],
    user: [
      `Screen: ${input.screen}${input.currentGameId === null ? "" : `, game on screen: ${input.currentGameId}`}.`,
      transcriptBlock(input.transcript, input.alternatives),
    ].join("\n"),
    tool: SELECT_APP_ACTION_TOOL,
    maxTokens: 200,
  });
  const { input: raw, ...call } = result;
  const parsed = SelectAppOutputSchema.safeParse(raw);
  if (!parsed.success) return { action: null, call };
  const { action, params } = parsed.data;
  const withDefaults =
    action === "NEW_GAME" ? { gameId: input.currentGameId, options: {}, ...params } : params;
  const app = AppActionSchema.safeParse({ ...withDefaults, action });
  if (!app.success) return { action: null, call };
  const known = new Set(input.games.map((game) => game.gameId));
  if (
    (app.data.action === "OPEN_GAME" || app.data.action === "NEW_GAME") &&
    !known.has(app.data.gameId)
  )
    return { action: null, call };
  return { action: app.data, call };
}

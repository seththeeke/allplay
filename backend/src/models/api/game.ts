import { z } from "zod";
import { GameOptionsSchema, OptionValueSchema } from "./common";

/** Game catalog contracts (game-engine.md sections 3 and 4.1). */

export const GameOptionDefinitionSchema = z.object({
  name: z.string().min(1),
  type: z.literal("ENUM"),
  values: z.array(OptionValueSchema).min(1),
  default: OptionValueSchema,
  labels: z.record(z.string(), z.string()),
});
export type GameOptionDefinition = z.infer<typeof GameOptionDefinitionSchema>;

/** One home tile that starts a game with fixed options (productionalization.md section 6). */
export const GameTileSchema = z.object({
  path: z.string().startsWith("/"),
  name: z.string().min(1),
  description: z.string(),
  options: GameOptionsSchema,
});
export type GameTile = z.infer<typeof GameTileSchema>;

export const GameCatalogEntrySchema = z.object({
  gameId: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  path: z.string().startsWith("/"),
  latestVersion: z.number().int().min(1),
  players: z.object({ min: z.number().int().min(1), max: z.number().int().min(1) }),
  options: z.array(GameOptionDefinitionSchema),
  source: z.enum(["CORE", "COMMUNITY"]),
  tiles: z.array(GameTileSchema).min(1),
});
export type GameCatalogEntry = z.infer<typeof GameCatalogEntrySchema>;

export const GamesResponseSchema = z.object({ games: z.array(GameCatalogEntrySchema) });
export type GamesResponse = z.infer<typeof GamesResponseSchema>;

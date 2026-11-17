import { z } from "zod";
import { OptionValueSchema } from "./common";

/** Game catalog contracts (game-engine.md sections 3 and 4.1). */

export const GameOptionDefinitionSchema = z.object({
  name: z.string().min(1),
  type: z.literal("ENUM"),
  values: z.array(OptionValueSchema).min(1),
  default: OptionValueSchema,
  labels: z.record(z.string(), z.string()),
});
export type GameOptionDefinition = z.infer<typeof GameOptionDefinitionSchema>;

export const GameCatalogEntrySchema = z.object({
  gameId: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  path: z.string().startsWith("/"),
  latestVersion: z.number().int().min(1),
  players: z.object({ min: z.number().int().min(1), max: z.number().int().min(1) }),
  options: z.array(GameOptionDefinitionSchema),
  source: z.enum(["CORE", "COMMUNITY"]),
});
export type GameCatalogEntry = z.infer<typeof GameCatalogEntrySchema>;

export const GamesResponseSchema = z.object({ games: z.array(GameCatalogEntrySchema) });
export type GamesResponse = z.infer<typeof GamesResponseSchema>;

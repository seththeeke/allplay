import { z } from "zod";

/** Shared contract types (game-engine.md sections 9 and 10). */

export const SuitSchema = z.enum(["SPADES", "HEARTS", "DIAMONDS", "CLUBS"]);
export type Suit = z.infer<typeof SuitSchema>;

export const CardFaceSchema = z.object({
  cardId: z.string().min(1),
  suit: SuitSchema,
  rank: z.number().int().min(1).max(13),
  name: z.string().min(1),
});
export type CardFace = z.infer<typeof CardFaceSchema>;

export const ZoneRefSchema = z.object({
  zoneId: z.string().min(1),
  type: z.string().min(1),
  index: z.number().int().min(1),
  label: z.string().min(1),
});
export type ZoneRef = z.infer<typeof ZoneRefSchema>;

export const OptionValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export const GameOptionsSchema = z.record(z.string(), OptionValueSchema);
export type GameOptions = z.infer<typeof GameOptionsSchema>;

export const IsoTimestampSchema = z.iso.datetime();

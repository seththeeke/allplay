import { z } from "zod";

/** Win and loss statistics for one player, game and variant (data-model.md section 8). */
export const PlayerStatsSchema = z.object({
  playerId: z.string().min(1),
  statsKey: z.string().min(1),
  gameId: z.string().min(1),
  variantKey: z.string(),
  gamesPlayed: z.number().int().min(0),
  gamesWon: z.number().int().min(0),
  gamesLost: z.number().int().min(0),
  bestScore: z.number().int().nullable(),
  fastestWinMoves: z.number().int().min(0).nullable(),
  currentWinStreak: z.number().int().min(0),
  longestWinStreak: z.number().int().min(0),
  totalMoves: z.number().int().min(0),
  lastPlayedAt: z.iso.datetime(),
  version: z.number().int().min(1),
  ttl: z.number().int().optional(),
  entityVersion: z.literal(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type PlayerStats = z.infer<typeof PlayerStatsSchema>;

/** `<gameId>#<variantKey>`, the item's sort key. */
export const statsKeyOf = (gameId: string, variantKey: string): string => `${gameId}#${variantKey}`;

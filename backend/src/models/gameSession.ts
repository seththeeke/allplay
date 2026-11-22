import { z } from "zod";
import type { GameState } from "../game-engine";

/** One game being played (data-model.md section 6). `state` holds hidden cards and the seed; it never leaves the server. */
export const GameSessionSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  rulesSource: z.enum(["CORE", "COMMUNITY"]),
  rulesVersion: z.number().int().min(1),
  engineSchemaVersion: z.number().int().min(1),
  options: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  variantKey: z.string(),
  seats: z.array(z.object({ seatId: z.string().min(1), playerId: z.string().min(1) })).min(1),
  status: z.enum(["IN_PROGRESS", "WON", "ABANDONED"]),
  version: z.number().int().min(0),
  state: z.custom<GameState>((value) => typeof value === "object" && value !== null),
  summary: z.record(z.string(), z.number()),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
  lastActionAt: z.iso.datetime().optional(),
  /* Only while every seat is a guest's (data-model.md section 1, principle 10). */
  ttl: z.number().int().optional(),
  entityVersion: z.literal(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type GameSession = z.infer<typeof GameSessionSchema>;

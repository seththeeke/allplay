import { z } from "zod";

/** Which sessions a player sits in (data-model.md section 7). */
export const SeatAssignmentSchema = z.object({
  playerId: z.string().min(1),
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  seatId: z.string().min(1),
  status: z.enum(["IN_PROGRESS", "WON", "ABANDONED"]),
  lastActionAt: z.iso.datetime(),
  playerGameKey: z.string().min(1),
  statusSortKey: z.string().min(1),
  entityVersion: z.literal(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type SeatAssignment = z.infer<typeof SeatAssignmentSchema>;

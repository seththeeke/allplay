import type { SeatAssignment } from "../../models/seatAssignment";

/** SeatAssignment persistence (data-model.md section 7). */
export interface SeatAssignmentDao {
  /** Creates or replaces the seat for its player and session. */
  put(seat: SeatAssignment): Promise<void>;
  get(playerId: string, sessionId: string): Promise<SeatAssignment | null>;
  /** The player's most recent in-progress seat for a game (the `ByPlayerGame` index), or null. */
  currentFor(playerId: string, gameId: string): Promise<SeatAssignment | null>;
}

import type { SeatAssignment } from "../../models/seatAssignment";

/**
 * SeatAssignment persistence (data-model.md section 7). Seats are written with
 * their session in the session DAO's transactions; `put` and `delete` serve
 * the merge and account deletion.
 */
export interface SeatAssignmentDao {
  get(playerId: string, sessionId: string): Promise<SeatAssignment | null>;
  /** The player's in-progress seat for a game (the `ByPlayerGame` index), or null. */
  currentFor(playerId: string, gameId: string): Promise<SeatAssignment | null>;
  /** Every seat of the player, newest session first. */
  list(playerId: string): Promise<SeatAssignment[]>;
  /** Creates or replaces the seat for its player and session. */
  put(seat: SeatAssignment): Promise<void>;
  delete(playerId: string, sessionId: string): Promise<void>;
}

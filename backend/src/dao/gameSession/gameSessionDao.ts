import type { GameSession } from "../../models/gameSession";
import type { SeatAssignment } from "../../models/seatAssignment";
import type { StatsWrite } from "../playerStats/playerStatsDao";

/** A write's version condition failed: the session changed or ended since it was read. */
export class SessionVersionConflictError extends Error {
  override readonly name = "SessionVersionConflictError";
}

/** A session with this id already exists. */
export class SessionExistsError extends Error {
  override readonly name = "SessionExistsError";
}

/** Everything that changes when a session ends (data-model.md section 6, write 3). */
export interface SessionEnd {
  session: GameSession;
  expectedVersion: number;
  seats: SeatAssignment[];
  stats: StatsWrite[];
}

/**
 * GameSession persistence (game-engine.md section 11.1). The in-memory and
 * DynamoDB implementations behave identically and share one contract test.
 * Starting and ending a session are transactions over the session, its seats
 * and the seat holders' stats (data-model.md section 6).
 */
export interface GameSessionDao {
  /** The session and its seats, all or nothing; SessionExistsError for a used id. */
  create(session: GameSession, seats: readonly SeatAssignment[]): Promise<void>;
  get(sessionId: string): Promise<GameSession | null>;
  /** Writes the session only when the stored `version` equals `expectedVersion`. */
  update(session: GameSession, expectedVersion: number): Promise<void>;
  /**
   * Ends a session: all or nothing, only while the stored session is
   * `IN_PROGRESS` at `expectedVersion` (else SessionVersionConflictError), and
   * each stats item at its expected version (else StatsVersionConflictError).
   */
  end(end: SessionEnd): Promise<void>;
  delete(sessionId: string): Promise<void>;
}

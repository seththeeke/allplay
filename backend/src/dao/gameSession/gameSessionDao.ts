import type { GameSession } from "../../models/gameSession";

/** A write's version condition failed: the session changed since it was read. */
export class SessionVersionConflictError extends Error {
  override readonly name = "SessionVersionConflictError";
}

/** A session with this id already exists. */
export class SessionExistsError extends Error {
  override readonly name = "SessionExistsError";
}

/**
 * GameSession persistence (game-engine.md section 11.1). The in-memory and
 * DynamoDB implementations behave identically and share one contract test.
 */
export interface GameSessionDao {
  create(session: GameSession): Promise<void>;
  get(sessionId: string): Promise<GameSession | null>;
  /** Writes the session only when the stored `version` equals `expectedVersion`. */
  update(session: GameSession, expectedVersion: number): Promise<void>;
}

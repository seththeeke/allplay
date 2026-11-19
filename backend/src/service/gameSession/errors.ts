import type { ApiErrorCode, SessionEnvelope } from "../../models/api";

/** A session failure with the API error code and HTTP status it maps to (game-engine.md section 11). */
export class GameSessionError extends Error {
  override readonly name = "GameSessionError";
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    /** The current envelope, sent with VERSION_CONFLICT so clients re-render without another request. */
    readonly current?: SessionEnvelope,
  ) {
    super(message);
  }
}

export const notFound = (what: string): GameSessionError =>
  new GameSessionError(404, "NOT_FOUND", `${what} not found`);
export const notSeated = (): GameSessionError =>
  new GameSessionError(403, "NOT_SEATED", "You are not playing in this game");
export const gameOver = (): GameSessionError =>
  new GameSessionError(422, "GAME_OVER", "This game is over");
export const illegalAction = (message: string): GameSessionError =>
  new GameSessionError(422, "ILLEGAL_ACTION", message);
export const invalidRequest = (message: string): GameSessionError =>
  new GameSessionError(400, "VALIDATION_ERROR", message);
export const versionConflict = (current: SessionEnvelope): GameSessionError =>
  new GameSessionError(
    409,
    "VERSION_CONFLICT",
    "The game changed; showing the latest state",
    current,
  );

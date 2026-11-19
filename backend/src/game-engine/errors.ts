/** Engine errors (game-engine.md section 8). Each has a stable `name` callers can switch on. */

export class RulesValidationError extends Error {
  override readonly name = "RulesValidationError";
  constructor(readonly issues: string[]) {
    super(`Rules document is invalid: ${issues.join("; ")}`);
  }
}

export type IllegalActionReason = "UNKNOWN_ACTION" | "NOT_LEGAL" | "GAME_OVER" | "NOT_SEATED";

export class IllegalActionError extends Error {
  override readonly name = "IllegalActionError";
  constructor(
    readonly reason: IllegalActionReason,
    readonly actionId: string,
  ) {
    super(`Action ${actionId} rejected: ${reason}`);
  }
}

export class UndoUnavailableError extends Error {
  override readonly name = "UndoUnavailableError";
}

export class EngineInvariantError extends Error {
  override readonly name = "EngineInvariantError";
}

/** Bad input to createGame: unknown or invalid options, a malformed seed, or wrong seats. */
export class InvalidGameInputError extends Error {
  override readonly name = "InvalidGameInputError";
}

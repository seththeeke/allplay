import type { ApiError } from "../models/api";

/** A failed API call, carrying the parsed error body (game-engine.md section 11). */
export class ApiRequestError extends Error {
  override readonly name = "ApiRequestError";

  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.message);
  }
}

/** A first sign-in with a temporary password: the player chooses their own (productionalization.md section 3). */
export class NewPasswordRequiredError extends Error {
  override readonly name = "NewPasswordRequiredError";

  constructor() {
    super("Choose your own password to finish signing in.");
  }
}

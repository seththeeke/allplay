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

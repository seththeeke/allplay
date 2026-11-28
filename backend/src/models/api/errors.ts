import { z } from "zod";
import { SessionEnvelopeSchema } from "./session";

/** Error body returned by every route (game-engine.md section 11, action-decision.md section 10). */

export const ApiErrorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_SEATED",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "ILLEGAL_ACTION",
  "GAME_OVER",
  "RATE_LIMITED",
  "ANDON_CORD_PULLED",
  "ALREADY_INVITED",
  "GAME_LIMIT_REACHED",
  "INTERNAL_ERROR",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorSchema = z.object({
  code: ApiErrorCodeSchema,
  message: z.string().min(1),
  speech: z.string().min(1).optional(),
  current: SessionEnvelopeSchema.optional(),
  /** With GAME_LIMIT_REACHED: the limit and when the window resets (productionalization.md section 5). */
  limit: z.number().int().min(0).optional(),
  period: z.enum(["DAY", "WEEK", "MONTH"]).optional(),
  resetsAt: z.iso.datetime().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

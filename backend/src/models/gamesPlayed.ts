import { z } from "zod";
import { LimitPeriodSchema } from "./api/common";

/** The count of one limit window (data-model.md section 4). */
export const GamesPlayedSchema = z.object({
  period: LimitPeriodSchema,
  windowStart: z.iso.date(),
  count: z.number().int().min(0),
});
export type GamesPlayed = z.infer<typeof GamesPlayedSchema>;

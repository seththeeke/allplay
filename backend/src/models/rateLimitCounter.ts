import { z } from "zod";

/** A fixed-window request counter for one player (data-model.md section 10). */
export const RateLimitCounterSchema = z.object({
  counterKey: z.string().min(1),
  count: z.number().int().min(0),
  ttl: z.number().int(),
});
export type RateLimitCounter = z.infer<typeof RateLimitCounterSchema>;

import { z } from "zod";

/** Stage-wide switches (data-model.md section 14); `ANDON` is the only flag. */
export const SystemFlagSchema = z.object({
  flagId: z.literal("ANDON"),
  isAndonCordPulled: z.boolean(),
  reason: z.string().min(1),
  pulledBy: z.enum(["BUDGET", "ADMIN"]),
  changedAt: z.iso.datetime(),
  changedBy: z.string().min(1).optional(),
  entityVersion: z.literal(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type SystemFlag = z.infer<typeof SystemFlagSchema>;

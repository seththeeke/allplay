import { z } from "zod";
import { DecisionOutcomeSchema, ScreenSchema, TranscriptSourceSchema } from "./api";

/**
 * One voice turn (data-model.md section 9). The intake (AD-12) records the
 * transcript and its context; classification and selection fields arrive with
 * the decider layers (AD-2 to AD-5).
 */
export const DecisionSchema = z.object({
  decisionId: z.string().min(1),
  playerId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  sessionVersion: z.number().int().min(0).optional(),
  transcriptSource: TranscriptSourceSchema,
  transcript: z.string().min(1),
  alternatives: z.array(z.object({ transcript: z.string(), confidence: z.number() })),
  uiContext: z.object({ screen: ScreenSchema, pendingPrompt: z.string().nullable() }),
  outcome: z.union([
    DecisionOutcomeSchema,
    z.enum(["CONFIRMED", "REJECTED", "CHOSE_OPTION", "INVALID", "EXPIRED", "ACKNOWLEDGED"]),
  ]),
  failureClass: z.enum(["PENDING", "HARD", "SOFT", "NONE"]),
  serverLatencyMs: z.number().int().min(0),
  ttl: z.number().int(),
  entityVersion: z.literal(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Decision = z.infer<typeof DecisionSchema>;

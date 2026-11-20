import { z } from "zod";
import { DecisionOutcomeSchema, ScreenSchema, TranscriptSourceSchema } from "./decision";

/** Local-only route contracts (local-development.md section 2). */

export const CapabilityStatusSchema = z.object({
  setting: z.string(),
  provider: z.string(),
  available: z.boolean(),
  detail: z.string(),
});
export type CapabilityStatus = z.infer<typeof CapabilityStatusSchema>;

export const LocalStatusSchema = z.object({
  preset: z.string(),
  capabilities: z.record(z.string(), CapabilityStatusSchema),
});
export type LocalStatus = z.infer<typeof LocalStatusSchema>;

export const TranscriptionResponseSchema = z.object({
  text: z.string(),
  transcriptSource: TranscriptSourceSchema,
  provider: z.string(),
  latencyMs: z.number().int().min(0),
});
export type TranscriptionResponse = z.infer<typeof TranscriptionResponseSchema>;

/** A decision as the Voice Lab shows it; the stored item has more fields. */
export const RecordedDecisionSchema = z.object({
  decisionId: z.string(),
  playerId: z.string(),
  transcript: z.string(),
  transcriptSource: TranscriptSourceSchema,
  uiContext: z.object({ screen: ScreenSchema, pendingPrompt: z.string().nullable() }),
  outcome: z.union([DecisionOutcomeSchema, z.string()]),
  createdAt: z.string(),
});
export type RecordedDecision = z.infer<typeof RecordedDecisionSchema>;

export const LocalDecisionsResponseSchema = z.object({
  decisions: z.array(RecordedDecisionSchema),
});
export type LocalDecisionsResponse = z.infer<typeof LocalDecisionsResponseSchema>;

import { z } from "zod";
import {
  AppActionSchema,
  ChoiceSchema,
  DecisionOutcomeSchema,
  ScreenSchema,
  TranscriptSourceSchema,
} from "./api";

/** Layer 1 categories (action-decision.md section 5). */
export const DecisionCategorySchema = z.enum(["GAME", "APPLICATION", "RESPONSE", "UNRECOGNIZED"]);
export type DecisionCategory = z.infer<typeof DecisionCategorySchema>;

const ModelCallSchema = z.object({
  modelId: z.string().min(1),
  latencyMs: z.number().int().min(0),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
});

export const FinalOutcomeSchema = z.enum([
  "CONFIRMED",
  "REJECTED",
  "CHOSE_OPTION",
  "INVALID",
  "EXPIRED",
  "ACKNOWLEDGED",
]);

/** Outcomes that still wait for the player (action-decision.md section 4.2). */
export const OPEN_OUTCOMES: ReadonlySet<string> = new Set(["PROPOSED", "CHOICES", "APP_ACTION"]);

/**
 * One voice turn (data-model.md section 9). An open decision keeps what was
 * shown in `proposal`, so a resolution or a spoken answer can act on it.
 */
export const DecisionSchema = z.object({
  decisionId: z.string().min(1),
  playerId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  gameId: z.string().min(1).optional(),
  sessionVersion: z.number().int().min(0).optional(),
  transcriptSource: TranscriptSourceSchema,
  transcript: z.string().min(1),
  alternatives: z.array(z.object({ transcript: z.string(), confidence: z.number() })),
  uiContext: z.object({ screen: ScreenSchema, pendingPrompt: z.string().nullable() }),
  classification: ModelCallSchema.extend({
    category: DecisionCategorySchema,
    response: z.enum(["CONFIRM", "REJECT", "OPTION"]).nullable(),
  }).optional(),
  candidateCount: z.number().int().min(0).optional(),
  candidatesDigest: z.string().optional(),
  selection: ModelCallSchema.extend({
    selectedIds: z.array(z.string()),
    confidence: z.enum(["HIGH", "LOW"]).optional(),
  }).optional(),
  proposal: z
    .object({
      kind: DecisionOutcomeSchema,
      text: z.string().min(1),
      actionIds: z.array(z.string().min(1)),
      appAction: AppActionSchema.nullable(),
      choices: z.array(ChoiceSchema).nullable(),
    })
    .optional(),
  outcome: z.union([DecisionOutcomeSchema, FinalOutcomeSchema]),
  failureClass: z.enum(["PENDING", "HARD", "SOFT", "NONE"]),
  serverLatencyMs: z.number().int().min(0),
  clientLatencyMs: z.number().int().min(0).optional(),
  dayOutcomeKey: z.string().min(1),
  ttl: z.number().int(),
  entityVersion: z.literal(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Decision = z.infer<typeof DecisionSchema>;

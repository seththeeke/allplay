import { z } from "zod";
import { CardFaceSchema, GameOptionsSchema, ZoneRefSchema } from "./common";

/** Game session contracts (game-engine.md sections 9 to 11). */

export const CardViewSchema = z.discriminatedUnion("faceUp", [
  CardFaceSchema.extend({ faceUp: z.literal(true) }),
  z.object({ faceUp: z.literal(false) }),
]);
export type CardView = z.infer<typeof CardViewSchema>;

export const ZoneViewSchema = ZoneRefSchema.extend({
  layout: z.enum(["FAN_DOWN", "STACK", "ROW"]),
  region: z.enum(["TOP", "MAIN", "BOTTOM"]),
  count: z.number().int().min(0),
  cards: z.array(CardViewSchema).nullable(),
});
export type ZoneView = z.infer<typeof ZoneViewSchema>;

export const GameStatusInfoSchema = z.object({
  status: z.enum(["IN_PROGRESS", "WON", "LOST"]),
  blocked: z.boolean(),
  canUndo: z.boolean(),
});
export type GameStatusInfo = z.infer<typeof GameStatusInfoSchema>;

export const GameViewSchema = z.object({
  gameId: z.string().min(1),
  rulesVersion: z.number().int().min(1),
  options: GameOptionsSchema,
  status: GameStatusInfoSchema,
  vars: z.record(z.string(), z.number()),
  zones: z.array(ZoneViewSchema),
});
export type GameView = z.infer<typeof GameViewSchema>;

export const ActionDescriptorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("MOVE_CARDS"),
    cards: z.array(CardFaceSchema).min(1),
    from: ZoneRefSchema,
    to: ZoneRefSchema.extend({ topCard: CardFaceSchema.nullable() }),
  }),
  z.object({ kind: z.literal("DEAL"), from: ZoneRefSchema, cardCount: z.number().int().min(1) }),
  z.object({ kind: z.literal("OTHER") }),
]);
export type ActionDescriptor = z.infer<typeof ActionDescriptorSchema>;

export const LegalActionSchema = z.object({
  actionId: z.string().min(1),
  templateId: z.string().min(1),
  params: z.record(z.string(), z.union([z.string(), z.number()])),
  descriptor: ActionDescriptorSchema,
  text: z.string().min(1),
  shortText: z.string().min(1),
  equivalenceKey: z.string().min(1).optional(),
});
export type LegalAction = z.infer<typeof LegalActionSchema>;

export const MetaActionSchema = z.object({
  id: z.enum(["UNDO", "HINT"]),
  available: z.boolean(),
});
export type MetaAction = z.infer<typeof MetaActionSchema>;

export const GameEventSchema = z.object({
  type: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
  speech: z.string().nullable().optional(),
});
export type GameEvent = z.infer<typeof GameEventSchema>;

export const SessionStatusSchema = z.enum(["IN_PROGRESS", "WON", "ABANDONED"]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const SessionSummarySchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  status: SessionStatusSchema,
  version: z.number().int().min(0),
  options: GameOptionsSchema,
  summary: z.record(z.string(), z.number()),
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const SessionEnvelopeSchema = z.object({
  session: SessionSummarySchema,
  view: GameViewSchema,
  legalActions: z.array(LegalActionSchema),
  metaActions: z.array(MetaActionSchema),
  events: z.array(GameEventSchema),
});
export type SessionEnvelope = z.infer<typeof SessionEnvelopeSchema>;

export const ActionSourceSchema = z.enum(["POINTER", "KEYBOARD", "VOICE"]);
export type ActionSource = z.infer<typeof ActionSourceSchema>;

export const StartSessionRequestSchema = z.object({
  gameId: z.string().min(1),
  options: GameOptionsSchema.optional(),
});
export type StartSessionRequest = z.infer<typeof StartSessionRequestSchema>;

export const ApplyActionRequestSchema = z.object({
  actionId: z.string().min(1),
  expectedVersion: z.number().int().min(0),
  source: ActionSourceSchema,
  decisionId: z.string().min(1).optional(),
});
export type ApplyActionRequest = z.infer<typeof ApplyActionRequestSchema>;

export const UndoRequestSchema = z.object({
  expectedVersion: z.number().int().min(0),
  source: ActionSourceSchema,
  decisionId: z.string().min(1).optional(),
});
export type UndoRequest = z.infer<typeof UndoRequestSchema>;

export const AbandonRequestSchema = z.object({ expectedVersion: z.number().int().min(0) });
export type AbandonRequest = z.infer<typeof AbandonRequestSchema>;

export const HintResponseSchema = z.object({
  action: LegalActionSchema.nullable(),
  text: z.string().min(1),
});
export type HintResponse = z.infer<typeof HintResponseSchema>;

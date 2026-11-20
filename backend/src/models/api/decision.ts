import { z } from "zod";
import { GameOptionsSchema } from "./common";
import { SessionEnvelopeSchema } from "./session";

/** Action decider contracts (action-decision.md sections 4 and 7). */

export const ThemeSchema = z.enum([
  "DEFAULT",
  "HIGH_CONTRAST",
  "BLACK_AND_WHITE",
  "FOUR_COLOR",
  "DARK",
]);
export type Theme = z.infer<typeof ThemeSchema>;

export const ScreenSchema = z.enum(["HOME", "GAME", "STATS", "SETTINGS", "HELP"]);
export type Screen = z.infer<typeof ScreenSchema>;

export const AppActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ZOOM_IN") }),
  z.object({ action: z.literal("ZOOM_OUT") }),
  z.object({ action: z.literal("ZOOM_RESET") }),
  z.object({ action: z.literal("SET_THEME"), theme: ThemeSchema }),
  z.object({ action: z.literal("SET_VOICE_OUTPUT"), enabled: z.boolean() }),
  z.object({ action: z.literal("SET_AUTO_CONFIRM"), enabled: z.boolean() }),
  z.object({ action: z.literal("REPEAT") }),
  z.object({ action: z.literal("SHOW_HELP") }),
  z.object({ action: z.literal("SHOW_STATS") }),
  z.object({ action: z.literal("SHOW_SETTINGS") }),
  z.object({ action: z.literal("GO_HOME") }),
  z.object({ action: z.literal("OPEN_GAME"), gameId: z.string().min(1) }),
  z.object({
    action: z.literal("NEW_GAME"),
    gameId: z.string().min(1),
    options: GameOptionsSchema,
  }),
  z.object({ action: z.literal("SIGN_IN") }),
  z.object({ action: z.literal("SIGN_OUT") }),
]);
export type AppAction = z.infer<typeof AppActionSchema>;

/** Application actions that always need confirmation (action-decision.md section 7). */
export const CONFIRMED_APP_ACTIONS: ReadonlySet<AppAction["action"]> = new Set([
  "NEW_GAME",
  "SIGN_IN",
  "SIGN_OUT",
]);

/** Where a transcript came from (action-decision.md sections 3.1, 3.2 and 3.4). */
export const TranscriptSourceSchema = z.enum([
  "TRANSCRIBE",
  "APPLE_SPEECH",
  "MACOS_SPEECH",
  "WHISPER",
  "TYPED",
]);
export type TranscriptSource = z.infer<typeof TranscriptSourceSchema>;

export const DecisionRequestSchema = z.object({
  transcript: z.string().min(1).max(500),
  alternatives: z
    .array(
      z.object({ transcript: z.string().min(1).max(500), confidence: z.number().min(0).max(1) }),
    )
    .max(2)
    .default([]),
  transcriptSource: TranscriptSourceSchema,
  context: z.object({
    screen: ScreenSchema,
    sessionId: z.string().min(1).nullable(),
    expectedVersion: z.number().int().min(0).nullable(),
    pendingDecisionId: z.string().min(1).nullable(),
  }),
});
export type DecisionRequest = z.input<typeof DecisionRequestSchema>;

export const ChoiceSchema = z.object({
  number: z.number().int().min(1).max(4),
  actionId: z.string().min(1),
  text: z.string().min(1),
});
export type Choice = z.infer<typeof ChoiceSchema>;

export const DecisionOutcomeSchema = z.enum([
  "PROPOSED",
  "CHOICES",
  "AUTO_APPLIED",
  "APP_ACTION",
  "RESOLVED",
  "UNRECOGNIZED",
]);
export type DecisionOutcome = z.infer<typeof DecisionOutcomeSchema>;

export const DecisionResponseSchema = z.object({
  decisionId: z.string().min(1),
  outcome: DecisionOutcomeSchema,
  displayText: z.string().min(1),
  speech: z.string().min(1),
  proposal: z.object({ actionId: z.string().min(1), text: z.string().min(1) }).nullable(),
  choices: z.array(ChoiceSchema).min(2).max(4).nullable(),
  appAction: AppActionSchema.nullable(),
  session: SessionEnvelopeSchema.nullable(),
});
export type DecisionResponse = z.infer<typeof DecisionResponseSchema>;

export const ResolutionRequestSchema = z.object({
  resolution: z.enum(["CONFIRMED", "CHOSE_OPTION", "REJECTED", "ACKNOWLEDGED"]),
  optionNumber: z.number().int().min(1).max(4).nullable(),
  expectedVersion: z.number().int().min(0).nullable(),
  clientLatencyMs: z.number().int().min(0),
});
export type ResolutionRequest = z.infer<typeof ResolutionRequestSchema>;

export const ResolutionResponseSchema = z.object({ session: SessionEnvelopeSchema.nullable() });
export type ResolutionResponse = z.infer<typeof ResolutionResponseSchema>;

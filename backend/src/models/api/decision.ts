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

/** How voice works in a game (conversational-ai.md section 2). */
export const VoiceModeSchema = z.enum(["CONVERSATIONAL", "TURN_BASED"]);
export type VoiceMode = z.infer<typeof VoiceModeSchema>;

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

/**
 * The prompt on screen when the player speaks again (action-decision.md
 * section 4.1): a confirmation of one action or application action, or two to
 * four choices in order. It is client input, so an action it names is applied
 * only if the engine finds it legal.
 */
export const PendingPromptSchema = z
  .object({
    decisionId: z.string().min(1),
    kind: z.enum(["CONFIRMATION", "CHOICES"]),
    actionIds: z.array(z.string().min(1).max(200)).max(4),
    appAction: AppActionSchema.nullable(),
  })
  .refine(
    (prompt) =>
      prompt.kind === "CHOICES"
        ? prompt.actionIds.length >= 2 && prompt.appAction === null
        : (prompt.actionIds.length === 1) !== (prompt.appAction !== null),
    { message: "A confirmation holds one action; choices hold two to four." },
  );
export type PendingPrompt = z.infer<typeof PendingPromptSchema>;

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
    pendingPrompt: PendingPromptSchema.nullable(),
    voiceMode: VoiceModeSchema.default("TURN_BASED"),
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
  "IGNORED",
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
  /** True when the speaker says nothing (conversational-ai.md section 4.2). */
  silent: z.boolean().optional(),
});
export type DecisionResponse = z.infer<typeof DecisionResponseSchema>;

/** A resolution carries everything it needs, because the server keeps no turn (action-decision.md section 4.2). */
export const ResolutionRequestSchema = z.object({
  resolution: z.enum(["CONFIRMED", "CHOSE_OPTION", "REJECTED", "ACKNOWLEDGED"]),
  sessionId: z.string().min(1).nullable(),
  actionId: z.string().min(1).max(200).nullable(),
  expectedVersion: z.number().int().min(0).nullable(),
  clientLatencyMs: z.number().int().min(0),
  voiceMode: VoiceModeSchema.optional(),
});
export type ResolutionRequest = z.infer<typeof ResolutionRequestSchema>;

export const ResolutionResponseSchema = z.object({
  session: SessionEnvelopeSchema.nullable(),
  /** The acknowledgement to speak in conversational mode. */
  speech: z.string().min(1).optional(),
});
export type ResolutionResponse = z.infer<typeof ResolutionResponseSchema>;

/** The game speaker's opening line (conversational-ai.md section 7). */
export const GreetingResponseSchema = z.object({
  text: z.string().min(1),
  kind: z.enum(["GREETING", "WELCOME_BACK"]),
});
export type GreetingResponse = z.infer<typeof GreetingResponseSchema>;

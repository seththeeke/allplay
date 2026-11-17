import { z } from "zod";
import { GameOptionsSchema, IsoTimestampSchema } from "./common";
import { ThemeSchema } from "./decision";

/** Player, preference and statistics contracts (data-model.md sections 4, 5 and 8; authn-authz.md section 5). */

/** The User Pool password policy (authn-authz.md section 3), shared so every client shows the same rule. */
export const PASSWORD_RULE =
  "Use at least 8 characters, with an uppercase letter, a lowercase letter and a number.";

/** Returns the policy text when a password breaks it, otherwise null. */
export function passwordProblem(password: string): string | null {
  const ok =
    password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password);
  return ok ? null : PASSWORD_RULE;
}

export const TierSchema = z.enum(["GUEST", "PLAYER", "PLAYER_PLUS", "ADMIN"]);
export type Tier = z.infer<typeof TierSchema>;

export const PlayerMeSchema = z.object({
  playerId: z.string().min(1),
  kind: z.enum(["GUEST", "ACCOUNT"]),
  tier: TierSchema,
  displayName: z.string().min(1).nullable(),
  email: z.email().nullable(),
});
export type PlayerMe = z.infer<typeof PlayerMeSchema>;

export const AppPreferencesSchema = z.object({
  zoomLevel: z.number().min(1).max(3).multipleOf(0.25),
  theme: ThemeSchema,
  voiceOutputEnabled: z.boolean(),
  voiceId: z.string().min(1),
  speechRate: z.number().min(0.75).max(1.5),
  autoConfirm: z.boolean(),
  reducedMotion: z.enum(["SYSTEM", "ON", "OFF"]),
  listenTimeoutMs: z.number().int().min(500).max(5000),
  appHelpSeen: z.boolean(),
});
export type AppPreferences = z.infer<typeof AppPreferencesSchema>;

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  zoomLevel: 1.25,
  theme: "DEFAULT",
  voiceOutputEnabled: false,
  voiceId: "Joanna",
  speechRate: 1,
  autoConfirm: false,
  reducedMotion: "SYSTEM",
  listenTimeoutMs: 1200,
  appHelpSeen: false,
};

export const GamePreferencesSchema = z.object({
  helpSeen: z.boolean(),
  lastOptions: GameOptionsSchema.nullable(),
  overrides: AppPreferencesSchema.partial(),
});
export type GamePreferences = z.infer<typeof GamePreferencesSchema>;

export const DEFAULT_GAME_PREFERENCES: GamePreferences = {
  helpSeen: false,
  lastOptions: null,
  overrides: {},
};

export const PreferencesResponseSchema = z.object({
  app: AppPreferencesSchema,
  games: z.record(z.string(), GamePreferencesSchema),
});
export type PreferencesResponse = z.infer<typeof PreferencesResponseSchema>;

export const PatchAppPreferencesSchema = AppPreferencesSchema.partial();
export type PatchAppPreferences = z.infer<typeof PatchAppPreferencesSchema>;

export const PatchGamePreferencesSchema = GamePreferencesSchema.partial();
export type PatchGamePreferences = z.infer<typeof PatchGamePreferencesSchema>;

export const StatsEntrySchema = z.object({
  gameId: z.string().min(1),
  variantKey: z.string().min(1),
  gamesPlayed: z.number().int().min(0),
  gamesWon: z.number().int().min(0),
  gamesLost: z.number().int().min(0),
  bestScore: z.number().int().nullable(),
  fastestWinMoves: z.number().int().min(0).nullable(),
  currentWinStreak: z.number().int().min(0),
  longestWinStreak: z.number().int().min(0),
  totalMoves: z.number().int().min(0),
  lastPlayedAt: IsoTimestampSchema.nullable(),
});
export type StatsEntry = z.infer<typeof StatsEntrySchema>;

export const StatsResponseSchema = z.object({ stats: z.array(StatsEntrySchema) });
export type StatsResponse = z.infer<typeof StatsResponseSchema>;

export const UpdateProfileRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(40),
});
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;

export const MergeTokenResponseSchema = z.object({
  token: z.string().min(32),
  expiresAt: IsoTimestampSchema,
});
export type MergeTokenResponse = z.infer<typeof MergeTokenResponseSchema>;

export const MergeRequestSchema = z.object({ token: z.string().min(32) });
export type MergeRequest = z.infer<typeof MergeRequestSchema>;

export const MergeResponseSchema = z.object({ mergedGuestId: z.string().min(1) });
export type MergeResponse = z.infer<typeof MergeResponseSchema>;

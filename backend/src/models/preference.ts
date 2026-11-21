import { z } from "zod";
import { AppPreferencesSchema, GamePreferencesSchema } from "./api";

/** `APP`, or `GAME#<gameId>` for one game's layer (data-model.md section 5). */
export const PreferenceScopeSchema = z.string().regex(/^(APP|GAME#[a-z0-9-]+)$/);

/** The values one scope can hold: application settings, or a game's settings and overrides. */
export const PreferenceValuesSchema = AppPreferencesSchema.partial().extend(
  GamePreferencesSchema.partial().shape,
);
export type PreferenceValues = z.infer<typeof PreferenceValuesSchema>;

/** One preference layer (data-model.md section 5); only the fields a player changed are stored. */
export const PreferenceSchema = PreferenceValuesSchema.extend({
  playerId: z.string().min(1),
  scope: PreferenceScopeSchema,
  ttl: z.number().int().optional(),
  entityVersion: z.literal(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Preference = z.infer<typeof PreferenceSchema>;

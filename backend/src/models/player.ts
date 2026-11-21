import { z } from "zod";

export const PlayerKindSchema = z.enum(["GUEST", "ACCOUNT"]);
export const SignInProviderSchema = z.enum(["COGNITO", "GOOGLE", "APPLE"]);
export type SignInProvider = z.infer<typeof SignInProviderSchema>;

/**
 * One guest or account (data-model.md section 4). `playerId` is
 * `GUEST#<identityId>` or `ACCT#<sub>`. Sets are arrays here; the DynamoDB
 * DAO stores them as string sets.
 */
export const PlayerSchema = z.object({
  playerId: z.string().regex(/^(GUEST|ACCT)#.+$/),
  kind: PlayerKindSchema,
  status: z.enum(["ACTIVE", "MERGED", "DELETED"]),
  identityIds: z.array(z.string().min(1)),
  cognitoSub: z.string().min(1).optional(),
  email: z.string().min(1).optional(),
  emailKey: z.string().min(1).optional(),
  displayName: z.string().min(1).optional(),
  signInProviders: z.array(SignInProviderSchema).optional(),
  mergedInto: z.string().min(1).optional(),
  mergedGuestIds: z.array(z.string().min(1)).optional(),
  mergedAccountIds: z.array(z.string().min(1)).optional(),
  relayEmailEnabled: z.boolean().optional(),
  firstSeenAt: z.iso.datetime(),
  lastActiveAt: z.iso.datetime(),
  ttl: z.number().int().optional(),
  entityVersion: z.literal(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Player = z.infer<typeof PlayerSchema>;

/** The `ByEmail` key: the email trimmed and lowercased (data-model.md section 4). */
export const emailKeyOf = (email: string): string => email.trim().toLowerCase();

/** Guest data lives 90 days past the last activity (data-model.md section 1, principle 10). */
export const GUEST_RETENTION_SECONDS = 90 * 24 * 60 * 60;

/** The `ttl` of a guest item last active at `at`. */
export const guestTtl = (at: Date): number =>
  Math.floor(at.getTime() / 1000) + GUEST_RETENTION_SECONDS;

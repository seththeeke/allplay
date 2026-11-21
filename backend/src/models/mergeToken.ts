import { z } from "zod";

/** Merge tokens live 10 minutes (data-model.md section 10). */
export const MERGE_TOKEN_SECONDS = 10 * 60;

/**
 * Single-use proof that the redeeming account also owned the source player
 * (data-model.md section 10): a guest for a guest merge, or an account for
 * account linking. Only the SHA-256 of the token is stored.
 */
export const MergeTokenSchema = z.object({
  tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
  sourcePlayerId: z.string().regex(/^(GUEST|ACCT)#.+$/),
  sourceKind: z.enum(["GUEST", "ACCOUNT"]),
  status: z.enum(["ISSUED", "REDEEMED"]),
  redeemedBy: z.string().min(1).optional(),
  ttl: z.number().int(),
  entityVersion: z.literal(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type MergeToken = z.infer<typeof MergeTokenSchema>;

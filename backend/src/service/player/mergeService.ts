import { createHash, randomBytes } from "node:crypto";
import { createDynamoMergeTokenDao } from "../../dao/mergeToken/dynamoMergeTokenDao";
import type { MergeTokenDao } from "../../dao/mergeToken/mergeTokenDao";
import { createDynamoPlayerDao } from "../../dao/player/dynamoPlayerDao";
import { createDynamoPreferenceDao } from "../../dao/preference/dynamoPreferenceDao";
import type { PlayerDao } from "../../dao/player/playerDao";
import type { PreferenceDao } from "../../dao/preference/preferenceDao";
import type { MergeResponse, MergeTokenResponse } from "../../models/api";
import { MERGE_TOKEN_SECONDS } from "../../models/mergeToken";
import type { Player } from "../../models/player";
import { PreferenceValuesSchema, type PreferenceValues } from "../../models/preference";
import { invalidRequest, notApplicable } from "../gameSession/errors";
import type { PlayerCaller } from "./playerService";

/**
 * One kind of data the merge moves from one player to another. Every step is
 * idempotent, so a retried merge gives the same result (data-model.md section
 * 10). Seats and stats join the steps with their tables (DM-3).
 */
export type MergeStep = (fromPlayerId: string, intoPlayerId: string, at: string) => Promise<void>;

/** Copies each preference scope the target lacks (data-model.md section 10, step 2). */
export function preferencesStep(preferences: PreferenceDao): MergeStep {
  return async (from, into, at) => {
    const held = new Set((await preferences.list(into)).map((item) => item.scope));
    for (const item of await preferences.list(from)) {
      if (held.has(item.scope)) continue;
      const values: PreferenceValues = PreferenceValuesSchema.parse(item);
      await preferences.patch(into, item.scope, values, at);
    }
  };
}

/** After the data moves: the Cognito side of an account merge (AA-12). */
export type AccountMergeHook = (primary: Player, duplicate: Player) => Promise<void>;

export interface MergeServiceDeps {
  players: PlayerDao;
  mergeTokens: MergeTokenDao;
  steps: readonly MergeStep[];
  afterAccountMerge?: AccountMergeHook;
  now?: () => Date;
  token?: () => string;
}

export interface MergeService {
  /** Issues a token whose source is the caller: a guest (guest merge) or an account (account linking). */
  issue(caller: PlayerCaller): Promise<MergeTokenResponse>;
  /**
   * Redeems a token as an account. A guest token folds the guest into the
   * caller; an account token, redeemed with `keep: SOURCE`, folds the caller
   * into the source account (authn-authz.md sections 6 and 6.1).
   */
  redeem(caller: PlayerCaller, token: string, keep?: "SOURCE"): Promise<MergeResponse>;
  /** Folds the duplicate account into the primary (authn-authz.md section 6.2). */
  mergeAccounts(primaryPlayerId: string, duplicatePlayerId: string): Promise<MergeResponse>;
}

/** The merge service over the deployed tables (PLAYERS_TABLE, PREFERENCES_TABLE, MERGE_TOKENS_TABLE). */
export function createDeployedMergeService(
  env: Readonly<Record<string, string | undefined>> = process.env,
  afterAccountMerge?: AccountMergeHook,
): MergeService {
  return createMergeService({
    players: createDynamoPlayerDao(env["PLAYERS_TABLE"] ?? ""),
    mergeTokens: createDynamoMergeTokenDao(env["MERGE_TOKENS_TABLE"] ?? ""),
    steps: [preferencesStep(createDynamoPreferenceDao(env["PREFERENCES_TABLE"] ?? ""))],
    ...(afterAccountMerge === undefined ? {} : { afterAccountMerge }),
  });
}

const hashOf = (token: string): string => createHash("sha256").update(token).digest("hex");
const union = (a: readonly string[] | undefined, b: readonly string[]): string[] =>
  [...new Set([...(a ?? []), ...b])].sort();

export function createMergeService(deps: MergeServiceDeps): MergeService {
  const now = deps.now ?? (() => new Date());
  const newToken = deps.token ?? (() => randomBytes(32).toString("base64url"));
  const runSteps = async (from: string, into: string, at: string) => {
    for (const step of deps.steps) await step(from, into, at);
  };
  /* A source already merged elsewhere cannot be merged again. */
  const foldable = (source: Player | null, into: string): boolean =>
    source === null ||
    source.status === "ACTIVE" ||
    (source.status === "MERGED" && source.mergedInto === into);

  const mergeGuest = async (guestId: string, accountId: string): Promise<MergeResponse> => {
    const at = now().toISOString();
    const guest = await deps.players.get(guestId);
    if (!foldable(guest, accountId)) throw notApplicable("This guest was already merged.");
    await runSteps(guestId, accountId, at);
    if (guest !== null && guest.status === "ACTIVE")
      await deps.players.update(guestId, { status: "MERGED", mergedInto: accountId }, at);
    const account = await deps.players.get(accountId);
    if (account !== null)
      await deps.players.update(
        accountId,
        { mergedGuestIds: union(account.mergedGuestIds, [guestId]) },
        at,
      );
    return { primaryPlayerId: accountId, mergedPlayerId: guestId };
  };

  const service: MergeService = {
    issue: async (caller) => {
      const at = now();
      const token = newToken();
      const ttl = Math.floor(at.getTime() / 1000) + MERGE_TOKEN_SECONDS;
      await deps.mergeTokens.create({
        tokenHash: hashOf(token),
        sourcePlayerId: caller.playerId,
        sourceKind: caller.tier === "GUEST" ? "GUEST" : "ACCOUNT",
        status: "ISSUED",
        ttl,
        entityVersion: 1,
        createdAt: at.toISOString(),
        updatedAt: at.toISOString(),
      });
      return { token, expiresAt: new Date(ttl * 1000).toISOString() };
    },
    redeem: async (caller, token, keep) => {
      if (caller.tier === "GUEST") throw invalidRequest("Sign in before merging.");
      const at = now();
      const redeemed = await deps.mergeTokens.redeem(
        hashOf(token),
        caller.playerId,
        at.toISOString(),
        Math.floor(at.getTime() / 1000),
      );
      if (redeemed === null)
        throw notApplicable("This merge link has expired or was already used.");
      if (redeemed.sourcePlayerId === caller.playerId)
        throw invalidRequest("Sign in with a different method to link it.");
      if (redeemed.sourceKind === "GUEST") {
        if (keep !== undefined) throw invalidRequest("A guest merge keeps the signed-in account.");
        return mergeGuest(redeemed.sourcePlayerId, caller.playerId);
      }
      if (keep !== "SOURCE") throw invalidRequest("Linking keeps the account the link came from.");
      return service.mergeAccounts(redeemed.sourcePlayerId, caller.playerId);
    },
    mergeAccounts: async (primaryId, duplicateId) => {
      if (primaryId === duplicateId) throw invalidRequest("Pick two different accounts.");
      const [primary, duplicate] = await Promise.all([
        deps.players.get(primaryId),
        deps.players.get(duplicateId),
      ]);
      if (primary?.kind !== "ACCOUNT" || primary.status !== "ACTIVE")
        throw notApplicable("The primary account is not an active account.");
      if (duplicate?.kind !== "ACCOUNT" || !foldable(duplicate, primaryId))
        throw notApplicable("The duplicate account cannot be merged.");
      const at = now().toISOString();
      await runSteps(duplicateId, primaryId, at);
      if (duplicate.status === "ACTIVE")
        await deps.players.update(duplicateId, { status: "MERGED", mergedInto: primaryId }, at);
      const merged = await deps.players.update(
        primaryId,
        {
          mergedAccountIds: union(primary.mergedAccountIds, [duplicateId]),
          signInProviders: union(
            primary.signInProviders,
            duplicate.signInProviders ?? [],
          ) as Player["signInProviders"],
        },
        at,
      );
      await deps.afterAccountMerge?.(merged, duplicate);
      return { primaryPlayerId: primaryId, mergedPlayerId: duplicateId };
    },
  };
  return service;
}

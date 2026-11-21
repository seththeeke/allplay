import { createDynamoPlayerDao } from "../../dao/player/dynamoPlayerDao";
import { PlayerExistsError, type PlayerDao } from "../../dao/player/playerDao";
import { createDynamoPreferenceDao } from "../../dao/preference/dynamoPreferenceDao";
import type { PreferenceDao } from "../../dao/preference/preferenceDao";
import {
  AppPreferencesSchema,
  DEFAULT_APP_PREFERENCES,
  DEFAULT_GAME_PREFERENCES,
  GamePreferencesSchema,
  type GamePreferences,
  type PatchAppPreferences,
  type PatchGamePreferences,
  type PlayerMe,
  type PreferencesResponse,
  type Tier,
} from "../../models/api";
import { guestTtl, type Player } from "../../models/player";
import type { Preference } from "../../models/preference";
import { createIdentityService, type IdentityService } from "./identityService";

/** Who is calling, as the controllers resolved it. */
export interface PlayerCaller {
  playerId: string;
  tier: Tier;
  identityId: string;
}

export interface PlayerServiceDeps {
  players: PlayerDao;
  preferences: PreferenceDao;
  /** The User Pool, for account deletion; absent where there is no pool (the local server). */
  userPool?: { id: string; identities: IdentityService };
  now?: () => Date;
}

export interface PlayerService {
  /**
   * Guest upsert (authn-authz.md section 4): creates a guest's `Player` on its
   * first request and moves `lastActiveAt` and the guest `ttl` at most hourly.
   * Accounts are touched the same way, without a ttl.
   */
  recordActivity(caller: PlayerCaller): Promise<void>;
  me(caller: PlayerCaller): Promise<PlayerMe>;
  preferences(playerId: string): Promise<PreferencesResponse>;
  patchApp(caller: PlayerCaller, patch: PatchAppPreferences): Promise<PreferencesResponse>;
  patchGame(
    caller: PlayerCaller,
    gameId: string,
    patch: PatchGamePreferences,
  ): Promise<PreferencesResponse>;
  /**
   * Account deletion (authn-authz.md section 8, data-model.md section 14):
   * deletes the preferences, leaves a tombstone `Player` with no email or
   * name, then deletes the Cognito user. Tables added later (seats, stats,
   * sessions) join this as their legs land.
   */
  deleteAccount(caller: PlayerCaller): Promise<void>;
  /** Revokes the account's refresh tokens on every device (authn-authz.md section 12). */
  signOut(caller: PlayerCaller): Promise<void>;
}

/** Only the fields a schema knows, so item keys and timestamps never leak into a response. */
function known<T extends object>(defaults: T, item: Readonly<Record<string, unknown>>): Partial<T> {
  return Object.fromEntries(
    Object.keys(defaults).flatMap((key) => (item[key] === undefined ? [] : [[key, item[key]]])),
  ) as Partial<T>;
}

/** The effective preferences: stored layers over the defaults (data-model.md section 5). */
function layered(items: readonly Preference[]): PreferencesResponse {
  const app = items.find((item) => item.scope === "APP");
  const games: Record<string, GamePreferences> = {};
  for (const item of items) {
    if (!item.scope.startsWith("GAME#")) continue;
    games[item.scope.slice("GAME#".length)] = GamePreferencesSchema.parse({
      ...DEFAULT_GAME_PREFERENCES,
      ...known(DEFAULT_GAME_PREFERENCES, item),
    });
  }
  return {
    app: AppPreferencesSchema.parse({
      ...DEFAULT_APP_PREFERENCES,
      ...(app === undefined ? {} : known(DEFAULT_APP_PREFERENCES, app)),
    }),
    games,
  };
}

export function createPlayerService(deps: PlayerServiceDeps): PlayerService {
  const now = deps.now ?? (() => new Date());
  const guest = (caller: PlayerCaller) => caller.tier === "GUEST";
  const ttlFor = (caller: PlayerCaller, at: Date) => (guest(caller) ? guestTtl(at) : undefined);
  const service: PlayerService = {
    recordActivity: async (caller) => {
      const at = now();
      if (await deps.players.touch(caller.playerId, at, ttlFor(caller, at))) return;
      if (!guest(caller) || (await deps.players.get(caller.playerId)) !== null) return;
      const stamp = at.toISOString();
      const player: Player = {
        playerId: caller.playerId,
        kind: "GUEST",
        status: "ACTIVE",
        identityIds: [caller.identityId],
        firstSeenAt: stamp,
        lastActiveAt: stamp,
        ttl: guestTtl(at),
        entityVersion: 1,
        createdAt: stamp,
        updatedAt: stamp,
      };
      try {
        await deps.players.create(player);
      } catch (error) {
        if (!(error instanceof PlayerExistsError)) throw error;
      }
    },
    me: async (caller) => {
      const player = guest(caller) ? null : await deps.players.get(caller.playerId);
      return {
        playerId: caller.playerId,
        kind: guest(caller) ? "GUEST" : "ACCOUNT",
        tier: caller.tier,
        displayName: player?.displayName ?? null,
        email: player?.email ?? null,
      };
    },
    preferences: async (playerId) => layered(await deps.preferences.list(playerId)),
    patchApp: async (caller, patch) => {
      const at = now();
      await deps.preferences.patch(
        caller.playerId,
        "APP",
        patch,
        at.toISOString(),
        ttlFor(caller, at),
      );
      return service.preferences(caller.playerId);
    },
    signOut: async (caller) => {
      if (deps.userPool !== undefined)
        await deps.userPool.identities.signOutBySub(
          deps.userPool.id,
          caller.playerId.slice("ACCT#".length),
        );
    },
    deleteAccount: async (caller) => {
      const at = now().toISOString();
      await deps.preferences.deleteAll(caller.playerId);
      if ((await deps.players.get(caller.playerId)) !== null) {
        await deps.players.update(caller.playerId, { status: "DELETED", identityIds: [] }, at, [
          "email",
          "emailKey",
          "displayName",
          "signInProviders",
          "cognitoSub",
          "relayEmailEnabled",
        ]);
      }
      if (deps.userPool !== undefined)
        await deps.userPool.identities.deleteUserBySub(
          deps.userPool.id,
          caller.playerId.slice("ACCT#".length),
        );
    },
    patchGame: async (caller, gameId, patch) => {
      const at = now();
      await deps.preferences.patch(
        caller.playerId,
        `GAME#${gameId}`,
        patch,
        at.toISOString(),
        ttlFor(caller, at),
      );
      return service.preferences(caller.playerId);
    },
  };
  return service;
}

/** The player service over the deployed tables named by PLAYERS_TABLE and PREFERENCES_TABLE. */
export function createDeployedPlayerService(
  env: Readonly<Record<string, string | undefined>> = process.env,
): PlayerService {
  const userPoolId = env["USER_POOL_ID"];
  return createPlayerService({
    players: createDynamoPlayerDao(env["PLAYERS_TABLE"] ?? ""),
    preferences: createDynamoPreferenceDao(env["PREFERENCES_TABLE"] ?? ""),
    ...(userPoolId === undefined
      ? {}
      : { userPool: { id: userPoolId, identities: createIdentityService() } }),
  });
}

/** The Players table DAO named by PLAYERS_TABLE, for services that update players directly. */
export function createDeployedPlayerDao(
  env: Readonly<Record<string, string | undefined>> = process.env,
): PlayerDao {
  return createDynamoPlayerDao(env["PLAYERS_TABLE"] ?? "");
}

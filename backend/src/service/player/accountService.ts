import { createDynamoPlayerDao } from "../../dao/player/dynamoPlayerDao";
import { PlayerExistsError, type PlayerDao } from "../../dao/player/playerDao";
import { emailKeyOf, type Player, type SignInProvider } from "../../models/player";

/** Cognito provider names to the stored `signInProviders` values (data-model.md section 4). */
const PROVIDERS: Readonly<Record<string, SignInProvider>> = {
  Google: "GOOGLE",
  SignInWithApple: "APPLE",
};

export const providerOf = (providerName: string | undefined): SignInProvider =>
  providerName === undefined ? "COGNITO" : (PROVIDERS[providerName] ?? "COGNITO");

export interface AccountSignIn {
  sub: string;
  email: string;
  displayName?: string;
  provider: SignInProvider;
}

export interface AccountServiceDeps {
  players: PlayerDao;
  now?: () => Date;
}

export interface AccountService {
  /** Creates the account `Player` (`ACCT#<sub>`) once; a second call is a no-op (post confirmation). */
  ensureAccount(signIn: AccountSignIn): Promise<Player>;
  /**
   * Records a sign-in (post authentication): touches `lastActiveAt`, adds the
   * provider, creates the account if it is missing, and returns the other
   * active accounts with the same email, which the account merge repairs.
   */
  recordSignIn(signIn: AccountSignIn): Promise<{ duplicates: string[] }>;
}

/** Accounts as the sign-in triggers write them (authn-authz.md section 3.2). */
export function createAccountService(deps: AccountServiceDeps): AccountService {
  const now = deps.now ?? (() => new Date());
  const ensureAccount = async (signIn: AccountSignIn): Promise<Player> => {
    const playerId = `ACCT#${signIn.sub}`;
    const existing = await deps.players.get(playerId);
    if (existing !== null) return existing;
    const at = now().toISOString();
    const player: Player = {
      playerId,
      kind: "ACCOUNT",
      status: "ACTIVE",
      identityIds: [],
      cognitoSub: signIn.sub,
      email: signIn.email,
      emailKey: emailKeyOf(signIn.email),
      ...(signIn.displayName === undefined ? {} : { displayName: signIn.displayName }),
      signInProviders: [signIn.provider],
      ...(signIn.email.toLowerCase().endsWith("@privaterelay.appleid.com")
        ? { relayEmailEnabled: true }
        : {}),
      firstSeenAt: at,
      lastActiveAt: at,
      entityVersion: 1,
      createdAt: at,
      updatedAt: at,
    };
    try {
      await deps.players.create(player);
      return player;
    } catch (error) {
      /* A concurrent trigger created it first; that item is the account. */
      if (error instanceof PlayerExistsError) return (await deps.players.get(playerId)) ?? player;
      throw error;
    }
  };
  return {
    ensureAccount,
    recordSignIn: async (signIn) => {
      const player = await ensureAccount(signIn);
      const at = now();
      await deps.players.touch(player.playerId, at);
      const providers = player.signInProviders ?? [];
      if (!providers.includes(signIn.provider)) {
        await deps.players.update(
          player.playerId,
          { signInProviders: [...providers, signIn.provider].sort() },
          at.toISOString(),
        );
      }
      const matches = await deps.players.listByEmail(emailKeyOf(signIn.email));
      return {
        duplicates: matches
          .filter((match) => match.status === "ACTIVE" && match.playerId !== player.playerId)
          .map((match) => match.playerId),
      };
    },
  };
}

/** The account service over the deployed Players table named by PLAYERS_TABLE. */
export function createDeployedAccountService(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AccountService {
  return createAccountService({ players: createDynamoPlayerDao(env["PLAYERS_TABLE"] ?? "") });
}

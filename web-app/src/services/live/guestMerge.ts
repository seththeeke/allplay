import type { MergeResponse, MergeTokenResponse, PlayerMe } from "../../models/api";
import type { PlayerService } from "../types";

/** The merge routes (authn-authz.md section 6). */
export interface MergeApi {
  issue(): Promise<MergeTokenResponse>;
  redeem(token: string, keep?: "SOURCE"): Promise<MergeResponse>;
}

/** Where a guest's merge token waits for the sign-in to finish (authn-authz.md section 6, step 1). */
export const MERGE_TOKEN_KEY = "allplay.mergeToken";

/** The HTTP status of a failed call, from either API client, or null for a network failure. */
function statusOf(failure: unknown): number | null {
  if (typeof failure !== "object" || failure === null) return null;
  const direct = (failure as { status?: unknown }).status;
  if (typeof direct === "number") return direct;
  const response = (failure as { response?: { statusCode?: unknown } }).response;
  return typeof response?.statusCode === "number" ? response.statusCode : null;
}

/**
 * The guest merge around a player service: before a guest signs in, signs
 * up or leaves for Google or Apple, it requests a merge token; once the
 * caller is an account, it redeems the token. `me()` redeems a waiting token
 * too, so a redirect sign-in or an interrupted merge finishes on the next
 * load while the token is valid. A refused token is dropped.
 */
export function withGuestMerge(
  player: PlayerService,
  api: MergeApi,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  now: () => Date = () => new Date(),
): PlayerService {
  const prepare = async () => {
    try {
      if ((await player.me()).kind !== "GUEST") return;
      storage.setItem(MERGE_TOKEN_KEY, JSON.stringify(await api.issue()));
    } catch {
      /* Without a token the sign-in still works; the guest's progress simply stays behind. */
    }
  };
  const redeemPending = async (me: PlayerMe): Promise<void> => {
    const stored = storage.getItem(MERGE_TOKEN_KEY);
    if (stored === null || me.kind === "GUEST") return;
    const pending = JSON.parse(stored) as Partial<MergeTokenResponse>;
    if (
      typeof pending.token !== "string" ||
      Date.parse(pending.expiresAt ?? "") <= now().getTime()
    ) {
      storage.removeItem(MERGE_TOKEN_KEY);
      return;
    }
    try {
      await api.redeem(pending.token);
      storage.removeItem(MERGE_TOKEN_KEY);
    } catch (failure) {
      const status = statusOf(failure);
      if (status !== null && status >= 400 && status < 500) storage.removeItem(MERGE_TOKEN_KEY);
    }
  };
  const settled = async (me: PlayerMe): Promise<PlayerMe> => {
    await redeemPending(me);
    return me;
  };
  return {
    ...player,
    me: async () => settled(await player.me()),
    signIn: async (email, password) => {
      await prepare();
      return settled(await player.signIn(email, password));
    },
    signInWithProvider: async (provider) => {
      await prepare();
      return player.signInWithProvider(provider);
    },
    signUp: async (email, password) => {
      await prepare();
      await player.signUp(email, password);
    },
    confirmSignUp: async (email, code) => settled(await player.confirmSignUp(email, code)),
  };
}

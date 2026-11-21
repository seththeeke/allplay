import type { MergeResponse, MergeTokenResponse, PlayerMe } from "../../models/api";
import type { PlayerService } from "../types";

/** The merge routes (authn-authz.md section 6). */
export interface MergeApi {
  issue(): Promise<MergeTokenResponse>;
  redeem(token: string, keep?: "SOURCE"): Promise<MergeResponse>;
}

/** A waiting token; `keep: SOURCE` marks account linking (authn-authz.md section 6.1). */
interface PendingToken {
  token?: unknown;
  expiresAt?: unknown;
  keep?: unknown;
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
 * The guest merge around a player service: a guest about to sign in, sign
 * up or leave for Google or Apple gets a merge token, redeemed once the
 * caller is an account. `me()` redeems a waiting token too, so a redirect or
 * an interrupted merge finishes on the next load. A refused token is dropped.
 * A link token (`keep: SOURCE`) is redeemed the same way, then this device
 * signs out so the player signs in again to the kept account.
 */
export function withGuestMerge(
  player: PlayerService,
  api: MergeApi,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  now: () => Date = () => new Date(),
): PlayerService {
  const read = (): PendingToken | null => {
    const stored = storage.getItem(MERGE_TOKEN_KEY);
    return stored === null ? null : (JSON.parse(stored) as PendingToken);
  };
  const usable = (
    pending: PendingToken | null,
  ): pending is PendingToken & { token: string; expiresAt: string } =>
    pending !== null &&
    typeof pending.token === "string" &&
    typeof pending.expiresAt === "string" &&
    Date.parse(pending.expiresAt) > now().getTime();
  const prepare = async () => {
    try {
      const pending = read();
      /* A link in progress is not replaced by a guest token. */
      if (usable(pending) && pending.keep === "SOURCE") return;
      if ((await player.me()).kind !== "GUEST") return;
      storage.setItem(MERGE_TOKEN_KEY, JSON.stringify(await api.issue()));
    } catch {
      /* Without a token the sign-in still works; the guest's progress simply stays behind. */
    }
  };
  const settled = async (me: PlayerMe): Promise<PlayerMe> => {
    const pending = read();
    if (pending === null || me.kind === "GUEST") return me;
    if (!usable(pending)) {
      storage.removeItem(MERGE_TOKEN_KEY);
      return me;
    }
    const link = pending.keep === "SOURCE";
    try {
      await (link ? api.redeem(pending.token, "SOURCE") : api.redeem(pending.token));
      storage.removeItem(MERGE_TOKEN_KEY);
    } catch (failure) {
      const status = statusOf(failure);
      if (status !== null && status >= 400 && status < 500) storage.removeItem(MERGE_TOKEN_KEY);
      return me;
    }
    return link ? player.startLink() : me;
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
    startLink: async () => {
      if ((await player.me()).kind === "GUEST") throw new Error("Sign in before linking.");
      storage.setItem(MERGE_TOKEN_KEY, JSON.stringify({ ...(await api.issue()), keep: "SOURCE" }));
      return player.startLink();
    },
  };
}

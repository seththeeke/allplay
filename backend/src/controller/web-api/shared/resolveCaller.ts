import type { Tier } from "../../../models/api";
import type { HttpEvent } from "./httpEvent";

/** The caller of a route, from the request's IAM identity only, never from a request body (CLAUDE.md section 5). */
export interface Caller {
  playerId: string;
  tier: Tier;
  /** The Identity Pool identity that made the request. */
  identityId: string;
}

const ROLE_TIERS: readonly [RegExp, Tier][] = [
  [/AdminRole/, "ADMIN"],
  [/PlayerPlusRole/, "PLAYER_PLUS"],
  [/PlayerRole/, "PLAYER"],
];

/** The tier of a signed-in caller from the Identity Pool role in `userArn` (`assumed-role/<roleName>/...`). */
function accountTier(userArn: string | undefined): Tier {
  const role = /assumed-role\/([^/]+)\//.exec(userArn ?? "")?.[1] ?? "";
  return ROLE_TIERS.find(([pattern]) => pattern.test(role))?.[1] ?? "PLAYER";
}

/**
 * Resolves the caller from the Identity Pool identity that IAM authorization
 * put on the request (authn-authz.md section 4): an `unauthenticated` identity
 * is `GUEST#<identityId>`, an `authenticated` one is `ACCT#<sub>` from its
 * `...:CognitoSignIn:<sub>` entry, and the role in `userArn` gives the tier.
 * When `identityPoolId` is given, an identity from any other pool is refused.
 * The local server writes the same fields (section 11), so there is no local branch.
 */
export function resolveCaller(event: HttpEvent, identityPoolId?: string): Caller | null {
  const iam = event.requestContext.authorizer?.iam;
  const identity = iam?.cognitoIdentity;
  if (identity === undefined || identity === null) return null;
  if (identityPoolId !== undefined && identity.identityPoolId !== identityPoolId) return null;
  const amr = identity.amr ?? [];
  if (amr.includes("authenticated")) {
    const sub = amr.map((entry) => /:CognitoSignIn:(.+)$/.exec(entry)?.[1]).find(Boolean);
    return sub === undefined
      ? null
      : {
          playerId: `ACCT#${sub}`,
          tier: accountTier(iam?.userArn),
          identityId: identity.identityId,
        };
  }
  return {
    playerId: `GUEST#${identity.identityId}`,
    tier: "GUEST",
    identityId: identity.identityId,
  };
}

const ORDER: readonly Tier[] = ["GUEST", "PLAYER", "PLAYER_PLUS", "ADMIN"];

/** True when `tier` meets the route's minimum (authn-authz.md section 5). */
export function tierAtLeast(tier: Tier, minimum: Tier): boolean {
  return ORDER.indexOf(tier) >= ORDER.indexOf(minimum);
}

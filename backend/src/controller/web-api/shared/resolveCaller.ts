import type { HttpEvent } from "./httpEvent";

/** The caller of a route, from the request's IAM identity only, never from the body (CLAUDE.md section 5). */
export interface Caller {
  playerId: string;
}

/**
 * Resolves the caller from the Identity Pool identity that IAM authorization
 * put on the request. Guests only until AA-5 adds accounts. The local server
 * writes its development identity into the same field (local-development.md
 * section 3), so this has no local branch.
 */
export function resolveCaller(event: HttpEvent): Caller | null {
  const identityId = event.requestContext.authorizer?.iam?.cognitoIdentity?.identityId;
  return identityId === undefined ? null : { playerId: `GUEST#${identityId}` };
}

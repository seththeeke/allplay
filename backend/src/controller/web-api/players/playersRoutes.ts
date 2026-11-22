/**
 * Route list for the player bundle (authn-authz.md section 5). It imports
 * nothing so cdk/ can read it (cdk-stacks.md section 5). New routes go at
 * the end: CDK names each route by its position, and a renamed route
 * collides with itself on deploy.
 */
export const playersRoutes = [
  { method: "GET", path: "/v1/players/me", auth: "IAM", minimumTier: "GUEST" },
  { method: "GET", path: "/v1/players/me/preferences", auth: "IAM", minimumTier: "GUEST" },
  {
    method: "PATCH",
    path: "/v1/players/me/preferences/{scope}",
    auth: "IAM",
    minimumTier: "GUEST",
  },
  { method: "DELETE", path: "/v1/players/me", auth: "IAM", minimumTier: "PLAYER" },
  { method: "POST", path: "/v1/players/me/sign-out", auth: "IAM", minimumTier: "PLAYER" },
  /* A guest issues for the guest merge, an account for account linking (authn-authz.md section 6). */
  { method: "POST", path: "/v1/players/me/merge-tokens", auth: "IAM", minimumTier: "GUEST" },
  { method: "POST", path: "/v1/players/me/merge", auth: "IAM", minimumTier: "PLAYER" },
  { method: "GET", path: "/v1/players/me/stats", auth: "IAM", minimumTier: "GUEST" },
] as const;

/** Apple's server-to-server notifications: public, because Apple signs the body (authn-authz.md section 12). */
export const appleNotificationsRoute = {
  method: "POST",
  path: "/v1/apple/notifications",
  auth: "NONE",
} as const;

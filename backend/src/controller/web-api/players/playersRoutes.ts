/**
 * Route list for the player bundle (authn-authz.md section 5). It imports
 * nothing so cdk/ can read it (cdk-stacks.md section 5). The stats, merge,
 * profile and deletion routes join with their legs.
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
] as const;

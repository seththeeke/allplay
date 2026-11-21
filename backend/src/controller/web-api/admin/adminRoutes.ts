/**
 * Route list for the admin bundle (authn-authz.md section 5). It imports
 * nothing so cdk/ can read it (cdk-stacks.md section 5). Metrics and
 * decisions join with their tables (DM-4, DM-5).
 */
export const adminRoutes = [
  { method: "GET", path: "/v1/admin/deployments", auth: "IAM", minimumTier: "ADMIN" },
  { method: "POST", path: "/v1/admin/deployments", auth: "IAM", minimumTier: "ADMIN" },
  { method: "GET", path: "/v1/admin/players/duplicates", auth: "IAM", minimumTier: "ADMIN" },
  { method: "POST", path: "/v1/admin/players/merge", auth: "IAM", minimumTier: "ADMIN" },
] as const;

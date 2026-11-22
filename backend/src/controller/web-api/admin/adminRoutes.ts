/**
 * Route list for the admin bundle (authn-authz.md section 5). It imports
 * nothing so cdk/ can read it (cdk-stacks.md section 5). New routes go at
 * the end, since CDK names each route by its position.
 */
export const adminRoutes = [
  { method: "GET", path: "/v1/admin/deployments", auth: "IAM", minimumTier: "ADMIN" },
  { method: "POST", path: "/v1/admin/deployments", auth: "IAM", minimumTier: "ADMIN" },
  { method: "GET", path: "/v1/admin/players/duplicates", auth: "IAM", minimumTier: "ADMIN" },
  { method: "POST", path: "/v1/admin/players/merge", auth: "IAM", minimumTier: "ADMIN" },
  { method: "GET", path: "/v1/admin/metrics", auth: "IAM", minimumTier: "ADMIN" },
  { method: "GET", path: "/v1/admin/decisions", auth: "IAM", minimumTier: "ADMIN" },
] as const;

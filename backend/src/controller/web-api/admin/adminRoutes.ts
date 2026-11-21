/**
 * Route list for the admin bundle (authn-authz.md section 5). It imports
 * nothing so cdk/ can read it (cdk-stacks.md section 5). Metrics, decisions
 * and the duplicate account routes join with their legs.
 */
export const adminRoutes = [
  { method: "GET", path: "/v1/admin/deployments", auth: "IAM", minimumTier: "ADMIN" },
  { method: "POST", path: "/v1/admin/deployments", auth: "IAM", minimumTier: "ADMIN" },
] as const;

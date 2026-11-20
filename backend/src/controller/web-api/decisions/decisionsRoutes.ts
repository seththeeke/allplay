/**
 * Route list for the decisions bundle (action-decision.md section 4). It
 * imports nothing so cdk/ can read it (cdk-stacks.md section 5).
 */
export const decisionsRoutes = [
  { method: "POST", path: "/v1/decisions", auth: "IAM", minimumTier: "GUEST" },
] as const;

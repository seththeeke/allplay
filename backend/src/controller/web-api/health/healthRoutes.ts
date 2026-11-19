/**
 * Route list for the health bundle. It imports nothing so cdk/ can read it
 * (cdk-stacks.md section 5). The health route is the one route without AWS_IAM.
 */
export const healthRoutes = [{ method: "GET", path: "/v1/health", auth: "NONE" }] as const;

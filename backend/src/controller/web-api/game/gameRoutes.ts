/**
 * Route list for the game bundle (game-engine.md section 11, cdk-stacks.md
 * section 4). It imports nothing so cdk/ can read it (cdk-stacks.md section 5).
 */
export const gameRoutes = [
  { method: "GET", path: "/v1/games", auth: "IAM", minimumTier: "GUEST" },
  { method: "GET", path: "/v1/games/{gameId}", auth: "IAM", minimumTier: "GUEST" },
  { method: "POST", path: "/v1/sessions", auth: "IAM", minimumTier: "GUEST" },
  { method: "GET", path: "/v1/sessions/current", auth: "IAM", minimumTier: "GUEST" },
  { method: "GET", path: "/v1/sessions/{sessionId}", auth: "IAM", minimumTier: "GUEST" },
  { method: "POST", path: "/v1/sessions/{sessionId}/actions", auth: "IAM", minimumTier: "GUEST" },
  { method: "POST", path: "/v1/sessions/{sessionId}/undo", auth: "IAM", minimumTier: "GUEST" },
  { method: "GET", path: "/v1/sessions/{sessionId}/hint", auth: "IAM", minimumTier: "GUEST" },
  { method: "POST", path: "/v1/sessions/{sessionId}/abandon", auth: "IAM", minimumTier: "GUEST" },
] as const;

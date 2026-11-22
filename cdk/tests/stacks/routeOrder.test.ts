import { describe, expect, it } from "vitest";
import { adminRoutes } from "../../../backend/src/controller/web-api/admin/adminRoutes";
import { decisionsRoutes } from "../../../backend/src/controller/web-api/decisions/decisionsRoutes";
import { playersRoutes } from "../../../backend/src/controller/web-api/players/playersRoutes";

/*
 * Routes already deployed, in the order that names them (AllPlayApi.addBundle).
 * A route list may only grow at its end; moving or removing one of these
 * makes CloudFormation create a route that collides with the existing one.
 */
const DEPLOYED: Record<string, readonly string[]> = {
  Players: [
    "GET /v1/players/me",
    "GET /v1/players/me/preferences",
    "PATCH /v1/players/me/preferences/{scope}",
    "DELETE /v1/players/me",
    "POST /v1/players/me/sign-out",
    "POST /v1/players/me/merge-tokens",
    "POST /v1/players/me/merge",
  ],
  Decisions: ["POST /v1/decisions", "POST /v1/decisions/{decisionId}/resolution"],
  Admin: [
    "GET /v1/admin/deployments",
    "POST /v1/admin/deployments",
    "GET /v1/admin/players/duplicates",
    "POST /v1/admin/players/merge",
  ],
};

describe("deployed route order", () => {
  it("keeps every deployed route at its position, so lists only grow at the end", () => {
    const lists: Record<string, readonly { method: string; path: string }[]> = {
      Players: playersRoutes,
      Admin: adminRoutes,
      Decisions: decisionsRoutes,
    };
    for (const [bundle, deployed] of Object.entries(DEPLOYED)) {
      const keys = (lists[bundle] ?? []).map((route) => `${route.method} ${route.path}`);
      expect(keys.slice(0, deployed.length)).toEqual(deployed);
    }
  });
});

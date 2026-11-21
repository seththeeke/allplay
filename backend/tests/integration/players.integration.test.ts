import { describe, expect, it } from "vitest";
import { PlayerMeSchema, PreferencesResponseSchema } from "../../src/models/api";
import { apiUrl } from "./apiUrl";
import { guestCredentials, identityPoolId, signedFetch } from "./guestCredentials";

/*
 * The player routes as a guest browser calls them (authn-authz.md sections 4
 * and 5): guest credentials, SigV4-signed requests through AWS_IAM, the
 * player Lambda and its tables. Runs in both stages; a guest visit is
 * ordinary use, and the guest's data expires after 90 days.
 */
describe.runIf(identityPoolId() !== undefined)("player routes as a guest", () => {
  it("answers who the guest is and their default preferences", async () => {
    const guest = await guestCredentials(identityPoolId() ?? "");
    const me = await signedFetch(new URL("v1/players/me", apiUrl()), guest);
    expect(me.status).toBe(200);
    expect(PlayerMeSchema.parse(await me.json())).toEqual({
      playerId: `GUEST#${guest.identityId}`,
      kind: "GUEST",
      tier: "GUEST",
      displayName: null,
      email: null,
    });
    const preferences = await signedFetch(new URL("v1/players/me/preferences", apiUrl()), guest);
    expect(PreferencesResponseSchema.parse(await preferences.json()).app.zoomLevel).toBe(1.25);
  });

  it("refuses an unsigned request", async () => {
    const response = await fetch(new URL("v1/players/me", apiUrl()));
    expect(response.status).toBe(403);
  });
});

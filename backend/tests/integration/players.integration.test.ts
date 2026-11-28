import { describe, expect, it } from "vitest";
import {
  MergeTokenResponseSchema,
  PlayerMeSchema,
  PreferencesResponseSchema,
} from "../../src/models/api";
import { apiUrl } from "./apiUrl";
import { guestCredentials, identityPoolId, signedFetch } from "./guestCredentials";
import { inviteOnly } from "./callers";
import { localTarget, writesAllowed } from "./stage";

/*
 * The player routes as a guest browser calls them (authn-authz.md sections 4
 * and 5): guest credentials, SigV4-signed requests through AWS_IAM, the
 * player Lambda and its tables. Runs in both stages; a guest visit is
 * ordinary use, and the guest's data expires after 90 days.
 */
describe.runIf(identityPoolId() !== undefined && !inviteOnly())("player routes as a guest", () => {
  it("answers who the guest is and their default preferences", async () => {
    const guest = await guestCredentials(identityPoolId() ?? "");
    const me = await signedFetch(new URL("v1/players/me", apiUrl()), guest);
    expect(me.status).toBe(200);
    const body = PlayerMeSchema.parse(await me.json());
    expect(body).toMatchObject({
      playerId: guest.playerId,
      kind: "GUEST",
      tier: "GUEST",
      displayName: null,
      email: null,
    });
    /* The stage's game limit applies to guests too (productionalization.md section 5). */
    expect(body.gameAllowance?.used).toBe(0);
    const preferences = await signedFetch(new URL("v1/players/me/preferences", apiUrl()), guest);
    expect(PreferencesResponseSchema.parse(await preferences.json()).app.zoomLevel).toBe(1.25);
  });

  /* The local server treats an unsigned call as the default guest (authn-authz.md section 11). */
  it.skipIf(localTarget())("refuses an unsigned request", async () => {
    const response = await fetch(new URL("v1/players/me", apiUrl()));
    expect(response.status).toBe(403);
  });

  it("refuses a guest redeeming a merge token (authn-authz.md section 6)", async () => {
    const guest = await guestCredentials(identityPoolId() ?? "");
    const redeemed = await signedFetch(new URL("v1/players/me/merge", apiUrl()), guest, {
      method: "POST",
      body: { token: "t".repeat(43) },
    });
    expect(redeemed.status).toBe(403);
  });

  /* Issuing writes a token item, which expires in 10 minutes; only Test's verification writes. */
  it.runIf(writesAllowed())("issues a guest a 10 minute merge token", async () => {
    const guest = await guestCredentials(identityPoolId() ?? "");
    const issued = await signedFetch(new URL("v1/players/me/merge-tokens", apiUrl()), guest, {
      method: "POST",
    });
    expect(issued.status).toBe(201);
    const { expiresAt } = MergeTokenResponseSchema.parse(await issued.json());
    expect(Date.parse(expiresAt) - Date.now()).toBeGreaterThan(9 * 60 * 1000);
  });
});

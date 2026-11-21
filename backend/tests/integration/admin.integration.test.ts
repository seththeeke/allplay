import { describe, expect, it } from "vitest";
import { apiUrl } from "./apiUrl";
import { guestCredentials, identityPoolId, signedFetch } from "./guestCredentials";

/*
 * The admin routes refuse everyone below ADMIN (authn-authz.md section 4): IAM
 * denies the guest role before the admin Lambda runs, and unsigned requests are
 * refused. Read-only, so it runs in both stages. The admin's own calls are AA-10.
 */
describe.runIf(identityPoolId() !== undefined)("admin routes", () => {
  it("refuse a guest and an unsigned request with 403", async () => {
    const guest = await guestCredentials(identityPoolId() ?? "");
    const signed = await signedFetch(new URL("v1/admin/deployments", apiUrl()), guest);
    expect(signed.status).toBe(403);
    expect((await fetch(new URL("v1/admin/deployments", apiUrl()))).status).toBe(403);
  });
});

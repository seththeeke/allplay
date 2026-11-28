import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { describe, expect, it } from "vitest";
import { inviteOnly } from "./callers";
import { guestCredentials, identityPoolId } from "./guestCredentials";

/*
 * A guest's credentials (authn-authz.md section 4): an unauthenticated
 * identity from the stage's Identity Pool, exchanged for temporary AWS
 * credentials of the guest role. Runs in both stages; it only creates a guest
 * identity, which costs nothing.
 */
describe.runIf(identityPoolId() !== undefined && identityPoolId() !== "local")(
  "guest identity",
  () => {
    /* An invite-only stage takes no guests (productionalization.md section 3). */
    it.runIf(inviteOnly())("refuses a guest identity in an invite-only stage", async () => {
      await expect(guestCredentials(identityPoolId() ?? "")).rejects.toThrow();
    });

    it.skipIf(inviteOnly())(
      "gets guest credentials that act as the stage's guest role",
      async () => {
        const guest = await guestCredentials(identityPoolId() ?? "");
        expect(guest.identityId).toMatch(/^us-east-1:/);
        const sts = new STSClient({ region: "us-east-1", credentials: guest });
        const caller = await sts.send(new GetCallerIdentityCommand({}));
        expect(caller.Arn).toMatch(
          new RegExp(`assumed-role/AllPlay-GuestRole-${process.env["EXPECTED_STAGE"] ?? "\\w+"}/`),
        );
      },
    );
  },
);

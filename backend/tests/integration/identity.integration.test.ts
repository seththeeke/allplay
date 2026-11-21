import {
  CognitoIdentityClient,
  GetCredentialsForIdentityCommand,
  GetIdCommand,
} from "@aws-sdk/client-cognito-identity";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { describe, expect, it } from "vitest";

/*
 * A guest's credentials (authn-authz.md section 4): an unauthenticated
 * identity from the stage's Identity Pool, exchanged for temporary AWS
 * credentials of the guest role. Runs in both stages; it only creates a guest
 * identity, which costs nothing.
 */
const identityPoolId = process.env["IDENTITY_POOL_ID"];
const region = identityPoolId?.split(":")[0] ?? "us-east-1";

describe.runIf(identityPoolId !== undefined && identityPoolId !== "")("guest identity", () => {
  it("gets guest credentials that act as the stage's guest role", async () => {
    const cognito = new CognitoIdentityClient({ region });
    const { IdentityId } = await cognito.send(new GetIdCommand({ IdentityPoolId: identityPoolId }));
    expect(IdentityId).toMatch(/^us-east-1:/);
    const { Credentials } = await cognito.send(
      new GetCredentialsForIdentityCommand({ IdentityId }),
    );
    expect(Credentials?.AccessKeyId).toBeTruthy();
    const sts = new STSClient({
      region,
      credentials: {
        accessKeyId: Credentials?.AccessKeyId ?? "",
        secretAccessKey: Credentials?.SecretKey ?? "",
        sessionToken: Credentials?.SessionToken ?? "",
      },
    });
    const caller = await sts.send(new GetCallerIdentityCommand({}));
    expect(caller.Arn).toMatch(
      new RegExp(`assumed-role/AllPlay-GuestRole-${process.env["EXPECTED_STAGE"] ?? "\\w+"}/`),
    );
  });
});

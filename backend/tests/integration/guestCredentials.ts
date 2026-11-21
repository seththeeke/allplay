import {
  CognitoIdentityClient,
  GetCredentialsForIdentityCommand,
  GetIdCommand,
} from "@aws-sdk/client-cognito-identity";
import { Hash } from "@smithy/hash-node";
import { SignatureV4 } from "@smithy/signature-v4";

export interface GuestCredentials {
  identityId: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}

export const identityPoolId = (): string | undefined => {
  const value = process.env["IDENTITY_POOL_ID"];
  return value === undefined || value === "" ? undefined : value;
};

/** A new guest's temporary credentials from the stage's Identity Pool (authn-authz.md section 4). */
export async function guestCredentials(poolId: string): Promise<GuestCredentials> {
  const region = poolId.split(":")[0] ?? "us-east-1";
  const cognito = new CognitoIdentityClient({ region });
  const { IdentityId } = await cognito.send(new GetIdCommand({ IdentityPoolId: poolId }));
  const { Credentials } = await cognito.send(new GetCredentialsForIdentityCommand({ IdentityId }));
  return {
    identityId: IdentityId ?? "",
    accessKeyId: Credentials?.AccessKeyId ?? "",
    secretAccessKey: Credentials?.SecretKey ?? "",
    sessionToken: Credentials?.SessionToken ?? "",
  };
}

/** A SigV4-signed API call with the caller's credentials, as Amplify makes it. */
export async function signedFetch(
  url: URL,
  credentials: GuestCredentials,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const region = credentials.identityId.split(":")[0] ?? "us-east-1";
  const body = init.body === undefined ? undefined : JSON.stringify(init.body);
  const signer = new SignatureV4({
    service: "execute-api",
    region,
    credentials,
    sha256: Hash.bind(null, "sha256"),
  });
  const signed = await signer.sign({
    method: init.method ?? "GET",
    protocol: url.protocol,
    hostname: url.hostname,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    headers: {
      host: url.hostname,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body }),
  });
  return fetch(url, {
    method: signed.method,
    headers: signed.headers,
    ...(body === undefined ? {} : { body }),
  });
}

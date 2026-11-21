import { randomBytes } from "node:crypto";
import {
  CognitoIdentityClient,
  GetCredentialsForIdentityCommand,
  GetIdCommand,
} from "@aws-sdk/client-cognito-identity";
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { AssumeRoleCommand, GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { Amplify } from "aws-amplify";
import { fetchAuthSession, signIn as amplifySignIn, signOut } from "aws-amplify/auth";
import { cognitoUserPoolsTokenProvider } from "aws-amplify/auth/cognito";
import { sharedInMemoryStorage } from "aws-amplify/utils";
import type { GuestCredentials } from "./guestCredentials";

/*
 * Throwaway accounts for Test's tier tests (authn-authz.md section 10). They
 * are created through the Test-only `AllPlay-IntegrationAccounts-Test` role,
 * sign in with SRP as the web app does, and are deleted in teardown.
 */

const REGION = "us-east-1";

export interface AccountSettings {
  userPoolId: string;
  clientId: string;
  identityPoolId: string;
  roleName: string;
}

/** The settings the pipeline passes to Test's verification, or undefined elsewhere. */
export function accountSettings(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AccountSettings | undefined {
  const [userPoolId, clientId, identityPoolId, roleName] = [
    env["USER_POOL_ID"],
    env["USER_POOL_CLIENT_ID"],
    env["IDENTITY_POOL_ID"],
    env["INTEGRATION_ACCOUNTS_ROLE"],
  ];
  if (!userPoolId || !clientId || !identityPoolId || !roleName) return undefined;
  return { userPoolId, clientId, identityPoolId, roleName };
}

export interface TestAccount {
  email: string;
  password: string;
  sub: string;
}

/** A Cognito admin client acting as the integration accounts role. */
async function adminClient(settings: AccountSettings): Promise<CognitoIdentityProviderClient> {
  const sts = new STSClient({ region: REGION });
  const { Account } = await sts.send(new GetCallerIdentityCommand({}));
  const { Credentials } = await sts.send(
    new AssumeRoleCommand({
      RoleArn: `arn:aws:iam::${Account ?? ""}:role/${settings.roleName}`,
      RoleSessionName: "allplay-integration-accounts",
      DurationSeconds: 900,
    }),
  );
  return new CognitoIdentityProviderClient({
    region: REGION,
    credentials: {
      accessKeyId: Credentials?.AccessKeyId ?? "",
      secretAccessKey: Credentials?.SecretAccessKey ?? "",
      sessionToken: Credentials?.SessionToken ?? "",
    },
  });
}

/** Creates a confirmed account with a permanent password, in `ADMIN` when asked. */
export async function createTestAccount(
  settings: AccountSettings,
  email: string,
  groups: string[] = [],
): Promise<TestAccount> {
  const client = await adminClient(settings);
  const password = `Aa1-${randomBytes(12).toString("hex")}`;
  const created = await client.send(
    new AdminCreateUserCommand({
      UserPoolId: settings.userPoolId,
      Username: email,
      MessageAction: "SUPPRESS",
      UserAttributes: [
        { Name: "email", Value: email },
        { Name: "email_verified", Value: "true" },
      ],
    }),
  );
  await client.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: settings.userPoolId,
      Username: email,
      Password: password,
      Permanent: true,
    }),
  );
  for (const group of groups)
    await client.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: settings.userPoolId,
        Username: email,
        GroupName: group,
      }),
    );
  const sub = created.User?.Attributes?.find((attribute) => attribute.Name === "sub")?.Value;
  if (sub === undefined) throw new Error("AdminCreateUser returned no sub.");
  return { email, password, sub };
}

export async function deleteTestAccount(settings: AccountSettings, email: string): Promise<void> {
  const client = await adminClient(settings);
  await client.send(
    new AdminDeleteUserCommand({ UserPoolId: settings.userPoolId, Username: email }),
  );
}

/** Signs in with SRP, as the web app's Amplify does, and returns the ID token (authn-authz.md section 7.1). */
export async function signIn(settings: AccountSettings, account: TestAccount): Promise<string> {
  Amplify.configure({
    Auth: { Cognito: { userPoolId: settings.userPoolId, userPoolClientId: settings.clientId } },
  });
  cognitoUserPoolsTokenProvider.setKeyValueStorage(sharedInMemoryStorage);
  await signOut();
  const result = await amplifySignIn({ username: account.email, password: account.password });
  if (!result.isSignedIn) throw new Error(`Sign-in stopped at ${result.nextStep.signInStep}.`);
  const token = (await fetchAuthSession()).tokens?.idToken?.toString();
  if (token === undefined) throw new Error("Sign-in returned no ID token.");
  return token;
}

/** Signed-in Identity Pool credentials for an ID token, as Amplify obtains them. */
export async function accountCredentials(
  settings: AccountSettings,
  idToken: string,
): Promise<GuestCredentials> {
  const cognito = new CognitoIdentityClient({ region: REGION });
  const logins = { [`cognito-idp.${REGION}.amazonaws.com/${settings.userPoolId}`]: idToken };
  const { IdentityId } = await cognito.send(
    new GetIdCommand({ IdentityPoolId: settings.identityPoolId, Logins: logins }),
  );
  const { Credentials } = await cognito.send(
    new GetCredentialsForIdentityCommand({ IdentityId, Logins: logins }),
  );
  return {
    identityId: IdentityId ?? "",
    accessKeyId: Credentials?.AccessKeyId ?? "",
    secretAccessKey: Credentials?.SecretKey ?? "",
    sessionToken: Credentials?.SessionToken ?? "",
  };
}

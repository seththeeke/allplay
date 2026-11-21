import {
  AdminAddUserToGroupCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  AdminUserGlobalSignOutCommand,
  AdminLinkProviderForUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  type UserType,
} from "@aws-sdk/client-cognito-identity-provider";

/** A user of the pool, as the sign-in triggers need it. */
export interface PoolUser {
  username: string;
  emailVerified: boolean;
  /** Federated identities linked to the user (`identities` attribute), by provider name such as `Google`. */
  providers: string[];
  createdAt: number;
}

/**
 * The User Pool admin calls the sign-in triggers make (authn-authz.md section
 * 3.2). A DAO-layer adapter, so services never import the Cognito client.
 */
export interface UserPoolDirectory {
  /** Users whose email equals `email`, ignoring case and surrounding spaces. */
  usersByEmail(userPoolId: string, email: string): Promise<PoolUser[]>;
  /** Links a Google or Apple identity to an existing user (`AdminLinkProviderForUser`). */
  linkProvider(
    userPoolId: string,
    destinationUsername: string,
    providerName: string,
    providerUserId: string,
  ): Promise<void>;
  addToGroup(userPoolId: string, username: string, group: string): Promise<void>;
  /** The pool username of the user with this `sub` (federated usernames are `<Provider>_<subject>`), or null. */
  usernameBySub(userPoolId: string, sub: string): Promise<string | null>;
  /** Deletes a user and every identity linked to it (`AdminDeleteUser`). */
  deleteUser(userPoolId: string, username: string): Promise<void>;
  /** Revokes every refresh token of a user (`AdminUserGlobalSignOut`). */
  globalSignOut(userPoolId: string, username: string): Promise<void>;
  /** The `sub` of a user by username, or null when there is no such user (`AdminGetUser`). */
  subOfUsername(userPoolId: string, username: string): Promise<string | null>;
}

/** The part of the Cognito client the directory uses, so tests can stand in for it. */
export interface CognitoSender {
  send(command: object): Promise<unknown>;
}

const attribute = (user: UserType, name: string): string =>
  user.Attributes?.find((a) => a.Name === name)?.Value ?? "";

/** Provider names from the `identities` attribute (a JSON list); malformed values count as none. */
export function providersOf(
  identities: string | undefined,
): { providerName: string; userId: string }[] {
  if (identities === undefined || identities === "") return [];
  try {
    const parsed = JSON.parse(identities) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry: unknown) => {
      const row = entry as { providerName?: unknown; userId?: unknown };
      return typeof row.providerName === "string" && typeof row.userId === "string"
        ? [{ providerName: row.providerName, userId: row.userId }]
        : [];
    });
  } catch {
    return [];
  }
}

export function createUserPoolDirectory(
  client: CognitoSender = new CognitoIdentityProviderClient({}),
): UserPoolDirectory {
  return {
    usersByEmail: async (userPoolId, email) => {
      const target = email.trim().toLowerCase();
      const byName = new Map<string, PoolUser>();
      /* ListUsers matches exactly, so both the given and the lowercased spelling are tried. */
      for (const variant of new Set([email.trim(), target])) {
        let token: string | undefined;
        do {
          const out = (await client.send(
            new ListUsersCommand({
              UserPoolId: userPoolId,
              Filter: `email = "${variant.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`,
              PaginationToken: token,
            }),
          )) as { Users?: UserType[]; PaginationToken?: string };
          for (const user of out.Users ?? []) {
            if (user.Username === undefined) continue;
            if (attribute(user, "email").trim().toLowerCase() !== target) continue;
            byName.set(user.Username, {
              username: user.Username,
              emailVerified: attribute(user, "email_verified") === "true",
              providers: providersOf(attribute(user, "identities")).map((p) => p.providerName),
              createdAt: user.UserCreateDate?.getTime() ?? 0,
            });
          }
          token = out.PaginationToken;
        } while (token !== undefined);
      }
      return [...byName.values()].sort((a, b) => a.createdAt - b.createdAt);
    },
    linkProvider: async (userPoolId, destinationUsername, providerName, providerUserId) => {
      await client.send(
        new AdminLinkProviderForUserCommand({
          UserPoolId: userPoolId,
          DestinationUser: { ProviderName: "Cognito", ProviderAttributeValue: destinationUsername },
          SourceUser: {
            ProviderName: providerName,
            ProviderAttributeName: "Cognito_Subject",
            ProviderAttributeValue: providerUserId,
          },
        }),
      );
    },
    usernameBySub: async (userPoolId, sub) => {
      const out = (await client.send(
        new ListUsersCommand({
          UserPoolId: userPoolId,
          Filter: `sub = "${sub.replaceAll("\\", "").replaceAll('"', "")}"`,
          Limit: 1,
        }),
      )) as { Users?: UserType[] };
      return out.Users?.[0]?.Username ?? null;
    },
    globalSignOut: async (userPoolId, username) => {
      await client.send(
        new AdminUserGlobalSignOutCommand({ UserPoolId: userPoolId, Username: username }),
      );
    },
    subOfUsername: async (userPoolId, username) => {
      try {
        const out = (await client.send(
          new AdminGetUserCommand({ UserPoolId: userPoolId, Username: username }),
        )) as { UserAttributes?: { Name?: string; Value?: string }[] };
        return out.UserAttributes?.find((a) => a.Name === "sub")?.Value ?? null;
      } catch (error) {
        if (error instanceof Error && error.name === "UserNotFoundException") return null;
        throw error;
      }
    },
    deleteUser: async (userPoolId, username) => {
      await client.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: username }));
    },
    addToGroup: async (userPoolId, username, group) => {
      await client.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: userPoolId,
          Username: username,
          GroupName: group,
        }),
      );
    },
  };
}

import {
  createUserPoolDirectory,
  providersOf,
  type UserPoolDirectory,
} from "../../dao/userPool/userPoolDirectory";

export { providersOf };

/**
 * The User Pool decisions the sign-in triggers make (authn-authz.md section
 * 3.2): whether an email already has a user, which existing user a new Google
 * or Apple identity should join, and the group a confirmed user enters.
 */
export interface IdentityService {
  emailInUse(userPoolId: string, email: string): Promise<boolean>;
  /** The oldest other user with this email that does not already have the provider, or null. */
  linkTarget(
    userPoolId: string,
    email: string,
    incomingUsername: string,
    providerName: string,
  ): Promise<string | null>;
  link(
    userPoolId: string,
    destinationUsername: string,
    providerName: string,
    providerUserId: string,
  ): Promise<void>;
  addToGroup(userPoolId: string, username: string, group: string): Promise<void>;
  /** Deletes the user with this `sub`, if it still exists (account deletion, authn-authz.md section 8). */
  deleteUserBySub(userPoolId: string, sub: string): Promise<void>;
}

export function createIdentityService(
  directory: UserPoolDirectory = createUserPoolDirectory(),
): IdentityService {
  return {
    emailInUse: async (userPoolId, email) =>
      (await directory.usersByEmail(userPoolId, email)).length > 0,
    linkTarget: async (userPoolId, email, incomingUsername, providerName) => {
      const users = (await directory.usersByEmail(userPoolId, email)).filter(
        (user) => user.username !== incomingUsername && !user.providers.includes(providerName),
      );
      return (users.find((user) => user.emailVerified) ?? users[0])?.username ?? null;
    },
    link: (userPoolId, destinationUsername, providerName, providerUserId) =>
      directory.linkProvider(userPoolId, destinationUsername, providerName, providerUserId),
    addToGroup: (userPoolId, username, group) => directory.addToGroup(userPoolId, username, group),
    deleteUserBySub: async (userPoolId, sub) => {
      const username = await directory.usernameBySub(userPoolId, sub);
      if (username !== null) await directory.deleteUser(userPoolId, username);
    },
  };
}

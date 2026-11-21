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
  /** Revokes the refresh tokens of the user with this `sub` (sign-out, authn-authz.md section 12). */
  signOutBySub(userPoolId: string, sub: string): Promise<void>;
  /**
   * The Cognito half of an account merge (authn-authz.md section 6.2, step 3):
   * deletes the duplicate's user, then links each of its Google or Apple
   * identities to the primary's user. A duplicate already gone is a no-op.
   * Returns the providers linked.
   */
  mergeUsers(userPoolId: string, primarySub: string, duplicateSub: string): Promise<string[]>;
  /** The account `playerId` of a Sign in with Apple user, from Apple's subject, or null. */
  playerIdForApple(userPoolId: string, appleSubject: string): Promise<string | null>;
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
    signOutBySub: async (userPoolId, sub) => {
      const username = await directory.usernameBySub(userPoolId, sub);
      if (username !== null) await directory.globalSignOut(userPoolId, username);
    },
    mergeUsers: async (userPoolId, primarySub, duplicateSub) => {
      const duplicate = await directory.usernameBySub(userPoolId, duplicateSub);
      if (duplicate === null) return [];
      const primary = await directory.usernameBySub(userPoolId, primarySub);
      if (primary === null) throw new Error("The primary account has no user in the pool.");
      const identities = await directory.identitiesOf(userPoolId, duplicate);
      /* An identity belongs to one user at a time, so the duplicate goes first. */
      await directory.deleteUser(userPoolId, duplicate);
      for (const identity of identities)
        await directory.linkProvider(userPoolId, primary, identity.providerName, identity.userId);
      return identities.map((identity) => identity.providerName);
    },
    playerIdForApple: async (userPoolId, appleSubject) => {
      /* A first Apple sign-in creates `SignInWithApple_<subject>`; one linked into another user has no user of its own. */
      const sub = await directory.subOfUsername(userPoolId, `SignInWithApple_${appleSubject}`);
      return sub === null ? null : `ACCT#${sub}`;
    },
    deleteUserBySub: async (userPoolId, sub) => {
      const username = await directory.usernameBySub(userPoolId, sub);
      if (username !== null) await directory.deleteUser(userPoolId, username);
    },
  };
}

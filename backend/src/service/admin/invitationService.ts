import { createIdentityService, type IdentityService } from "../player/identityService";

/** Admin invitations (productionalization.md section 3, item 4). */
export interface InvitationService {
  /** `INVITED` when a user was created, `ALREADY_INVITED` when the email already has one. */
  invite(email: string): Promise<"INVITED" | "ALREADY_INVITED">;
}

export function createInvitationService(
  identities: Pick<IdentityService, "invite">,
  userPoolId: string,
): InvitationService {
  return {
    invite: async (email) =>
      (await identities.invite(userPoolId, email)) ? "INVITED" : "ALREADY_INVITED",
  };
}

/** Invitations for the local server, which has no User Pool: each email is invited once. */
export function createInMemoryInvitationService(): InvitationService & { invited: Set<string> } {
  const invited = new Set<string>();
  return {
    invited,
    invite: (email) => {
      const address = email.trim().toLowerCase();
      if (invited.has(address)) return Promise.resolve("ALREADY_INVITED");
      invited.add(address);
      return Promise.resolve("INVITED");
    },
  };
}

/** Invitations over the stage's User Pool, named by USER_POOL_ID. */
export function createDeployedInvitationService(
  env: Readonly<Record<string, string | undefined>> = process.env,
): InvitationService {
  return createInvitationService(createIdentityService(), env["USER_POOL_ID"] ?? "");
}

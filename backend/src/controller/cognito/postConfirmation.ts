import type { Logger } from "../../logger";
import {
  providerOf,
  type AccountService,
  type AccountSignIn,
} from "../../service/player/accountService";
import type { IdentityService } from "../../service/player/identityService";
import { federatedIdentity, TriggerEventSchema, type TriggerEvent } from "./triggerEvent";

export interface AccountTriggerDeps {
  accounts: AccountService;
  logger: Logger;
}

/** The sign-in an account trigger records, or null when the event carries no sub or email. */
export function signInOf(event: TriggerEvent): AccountSignIn | null {
  const attributes = event.request.userAttributes;
  const sub = attributes["sub"];
  const email = attributes["email"];
  if (sub === undefined || email === undefined || email === "") return null;
  const name = attributes["name"];
  return {
    sub,
    email,
    ...(name === undefined || name === "" ? {} : { displayName: name }),
    provider: providerOf(federatedIdentity(event)?.providerName),
  };
}

/**
 * Post confirmation trigger (authn-authz.md section 3.2): adds the user to
 * `PLAYER` and creates the account `Player`. Failures are logged, never
 * thrown, so confirmation is not blocked; post authentication creates a
 * missing account on the next sign-in.
 */
export function createPostConfirmationHandler(
  deps: AccountTriggerDeps & { identities: IdentityService },
): (event: unknown) => Promise<unknown> {
  return async (raw) => {
    const event = TriggerEventSchema.parse(raw);
    if (event.triggerSource !== "PostConfirmation_ConfirmSignUp") return event;
    try {
      await deps.identities.addToGroup(event.userPoolId, event.userName, "PLAYER");
      const signIn = signInOf(event);
      if (signIn === null)
        deps.logger.warn("Confirmed user has no sub or email; no player created");
      else await deps.accounts.ensureAccount(signIn);
    } catch (error) {
      deps.logger.error("Post confirmation failed", { error });
    }
    return event;
  };
}

import type { Logger } from "../../logger";
import type { IdentityService } from "../../service/player/identityService";
import {
  ACCOUNT_LINKED,
  federatedIdentity,
  TriggerEventSchema,
  USE_SOCIAL_SIGN_IN,
} from "./triggerEvent";

export interface PreSignUpDeps {
  identities: IdentityService;
  logger: Logger;
}

/**
 * Pre sign-up trigger (authn-authz.md section 3.2). A Google or Apple sign-up
 * whose verified email has a user is linked to it, then refused with
 * ALLPLAY_ACCOUNT_LINKED, because Cognito would still create a separate user
 * for this first sign-in; the client retries and reaches the linked user. A
 * failed link is logged and sign-up continues. A password sign-up for a taken
 * email is refused with ALLPLAY_USE_SOCIAL_SIGN_IN.
 */
export function createPreSignUpHandler(deps: PreSignUpDeps): (event: unknown) => Promise<unknown> {
  return async (raw) => {
    const event = TriggerEventSchema.parse(raw);
    const email = event.request.userAttributes["email"]?.trim() ?? "";
    if (event.triggerSource === "PreSignUp_SignUp") {
      if (email !== "" && (await deps.identities.emailInUse(event.userPoolId, email))) {
        deps.logger.info("Password sign-up refused: email already has a user");
        throw new Error(USE_SOCIAL_SIGN_IN);
      }
      return event;
    }
    if (event.triggerSource !== "PreSignUp_ExternalProvider") return event;
    const verified = event.request.userAttributes["email_verified"] === "true";
    const response = { ...event.response, autoConfirmUser: true, autoVerifyEmail: verified };
    const incoming = federatedIdentity(event);
    if (!verified || email === "" || incoming === null) return { ...event, response };
    const destination = await deps.identities.linkTarget(
      event.userPoolId,
      email,
      event.userName,
      incoming.providerName,
    );
    if (destination === null) return { ...event, response };
    try {
      await deps.identities.link(
        event.userPoolId,
        destination,
        incoming.providerName,
        incoming.userId,
      );
    } catch (error) {
      deps.logger.warn("Provider link failed; sign-up continues and leaves a duplicate", {
        metric: "DUPLICATE_ACCOUNT",
        provider: incoming.providerName,
        error,
      });
      return { ...event, response };
    }
    deps.logger.info("Linked a federated identity to an existing user", {
      provider: incoming.providerName,
    });
    throw new Error(ACCOUNT_LINKED);
  };
}

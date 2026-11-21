import { signInOf, type AccountTriggerDeps } from "./postConfirmation";
import { TriggerEventSchema } from "./triggerEvent";

/**
 * Post authentication trigger (authn-authz.md section 3.2): records the
 * sign-in and logs a DUPLICATE_ACCOUNT metric when another active account has
 * the same email. It never blocks sign-in; failures are logged.
 */
export function createPostAuthenticationHandler(
  deps: AccountTriggerDeps,
): (event: unknown) => Promise<unknown> {
  return async (raw) => {
    const event = TriggerEventSchema.parse(raw);
    const signIn = signInOf(event);
    if (signIn === null) return event;
    try {
      const { duplicates } = await deps.accounts.recordSignIn(signIn);
      if (duplicates.length > 0)
        deps.logger.warn("Duplicate account", {
          metric: "DUPLICATE_ACCOUNT",
          playerId: `ACCT#${signIn.sub}`,
          duplicates,
        });
    } catch (error) {
      deps.logger.error("Post authentication failed", { error });
    }
    return event;
  };
}

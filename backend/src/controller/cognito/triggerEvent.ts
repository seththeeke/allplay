import { z } from "zod";
import { providersOf } from "../../service/player/identityService";

/** The fields of a Cognito sign-up or sign-in trigger event the All Play triggers read. */
export const TriggerEventSchema = z.looseObject({
  triggerSource: z.string(),
  userPoolId: z.string().min(1),
  userName: z.string().min(1),
  request: z.looseObject({
    userAttributes: z.record(z.string(), z.string()).default({}),
  }),
  response: z.looseObject({}).default({}),
});
export type TriggerEvent = z.infer<typeof TriggerEventSchema>;

/** Cognito's names for the federated providers All Play links (authn-authz.md section 3.1). */
const LINKABLE: Readonly<Record<string, string>> = {
  google: "Google",
  signinwithapple: "SignInWithApple",
};

/**
 * The federated identity behind an event: from the `identities` attribute,
 * or from a federated username (`<Provider>_<subject>`) when that attribute is
 * missing, as it often is in pre sign-up. Null for a native user.
 */
export function federatedIdentity(
  event: TriggerEvent,
): { providerName: string; userId: string } | null {
  for (const identity of providersOf(event.request.userAttributes["identities"])) {
    const providerName = LINKABLE[identity.providerName.toLowerCase()];
    if (providerName !== undefined) return { providerName, userId: identity.userId };
  }
  const split = event.userName.indexOf("_");
  if (split <= 0) return null;
  const providerName = LINKABLE[event.userName.slice(0, split).toLowerCase()];
  const userId = event.userName.slice(split + 1);
  return providerName === undefined || userId === "" ? null : { providerName, userId };
}

/** Stable tokens Cognito echoes inside the error a client receives, so clients can show tailored copy. */
export const USE_SOCIAL_SIGN_IN = "ALLPLAY_USE_SOCIAL_SIGN_IN";
export const ACCOUNT_LINKED = "ALLPLAY_ACCOUNT_LINKED";

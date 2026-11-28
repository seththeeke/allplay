import { logger } from "../../logger";
import { createDeployedAccountService } from "../../service/player/accountService";
import { createIdentityService } from "../../service/player/identityService";
import { createPostAuthenticationHandler } from "./postAuthentication";
import { createPostConfirmationHandler } from "./postConfirmation";
import { createPreSignUpHandler } from "./preSignUp";

/*
 * Entry points of the sign-in trigger Lambdas (authn-authz.md section 3.2).
 * Each Lambda bundles this file and uses one export as its handler.
 */
const identities = createIdentityService();

export const preSignUp = createPreSignUpHandler({
  identities,
  accessMode: process.env["ACCESS_MODE"] === "INVITE_ONLY" ? "INVITE_ONLY" : "OPEN",
  logger: logger.child({ trigger: "pre-sign-up" }),
});
export const postConfirmation = createPostConfirmationHandler({
  identities,
  accounts: createDeployedAccountService(),
  logger: logger.child({ trigger: "post-confirmation" }),
});
export const postAuthentication = createPostAuthenticationHandler({
  accounts: createDeployedAccountService(),
  logger: logger.child({ trigger: "post-authentication" }),
});

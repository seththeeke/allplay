import { z } from "zod";
import type { Logger } from "../../logger";
import { renderEmail, type EmailKind } from "./templates/emailTemplates";

/** The fields of a Cognito custom message event this trigger reads (authn-authz.md section 3.2). */
export const CustomMessageEventSchema = z.looseObject({
  triggerSource: z.string(),
  request: z.looseObject({
    codeParameter: z.string().nullish(),
    usernameParameter: z.string().nullish(),
  }),
  response: z.looseObject({}),
});
export type CustomMessageEvent = z.infer<typeof CustomMessageEventSchema>;

const KINDS: Readonly<Record<string, EmailKind>> = {
  CustomMessage_SignUp: "SIGN_UP",
  CustomMessage_ResendCode: "RESEND_CODE",
  CustomMessage_ForgotPassword: "FORGOT_PASSWORD",
  CustomMessage_UpdateUserAttribute: "VERIFY_ATTRIBUTE",
  CustomMessage_VerifyUserAttribute: "VERIFY_ATTRIBUTE",
  CustomMessage_AdminCreateUser: "ADMIN_CREATE_USER",
};

/**
 * Custom message trigger: swaps Cognito's default email for the All Play
 * template. Sources it does not render (for example SMS-only ones) return the
 * event unchanged, so Cognito sends its default message.
 */
export function createCustomMessageHandler(logger: Logger): (event: unknown) => Promise<unknown> {
  return (raw) =>
    new Promise((resolve) => {
      const event = CustomMessageEventSchema.parse(raw);
      const kind = KINDS[event.triggerSource];
      const code = event.request.codeParameter;
      if (kind === undefined || code === undefined || code === null) {
        logger.info("Custom message left as default", { triggerSource: event.triggerSource });
        resolve(event);
        return;
      }
      const username =
        kind === "ADMIN_CREATE_USER" ? (event.request.usernameParameter ?? undefined) : undefined;
      const email = renderEmail(kind, code, username);
      logger.info("Custom message rendered", { triggerSource: event.triggerSource });
      resolve({
        ...event,
        response: { ...event.response, emailSubject: email.subject, emailMessage: email.html },
      });
    });
}

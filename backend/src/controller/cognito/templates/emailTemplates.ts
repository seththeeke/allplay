/** The emails Cognito sends, rendered by the custom message trigger (authn-authz.md section 3.2). */
export type EmailKind =
  "SIGN_UP" | "RESEND_CODE" | "FORGOT_PASSWORD" | "VERIFY_ATTRIBUTE" | "ADMIN_CREATE_USER";

export interface RenderedEmail {
  subject: string;
  html: string;
}

const COPY: Record<EmailKind, { subject: string; heading: string; body: string }> = {
  SIGN_UP: {
    subject: "Your All Play code",
    heading: "Welcome to All Play",
    body: "Enter this code to finish creating your account.",
  },
  RESEND_CODE: {
    subject: "Your All Play code",
    heading: "Here is a new code",
    body: "Enter this code to finish creating your account.",
  },
  FORGOT_PASSWORD: {
    subject: "Reset your All Play password",
    heading: "Reset your password",
    body: "Enter this code to choose a new password. If you did not ask for this, you can ignore this email.",
  },
  VERIFY_ATTRIBUTE: {
    subject: "Confirm your All Play email",
    heading: "Confirm your email",
    body: "Enter this code to confirm your email address.",
  },
  ADMIN_CREATE_USER: {
    subject: "You are invited to play All Play",
    heading: "You are invited to play All Play",
    body: "Sign in with this email and the temporary password below, then choose your own password.",
  },
};

/**
 * Plain, large-type HTML (authn-authz.md section 3.2): no images, one column,
 * 22 px body text and the code in 32 px. `code` and `username` are Cognito's
 * placeholders (`{####}`, `{username}`), which Cognito fills in after the
 * trigger returns, so they are inserted as given.
 */
export function renderEmail(kind: EmailKind, code: string, username?: string): RenderedEmail {
  const copy = COPY[kind];
  const user =
    username === undefined
      ? ""
      : `<p style="font-size:22px;margin:0 0 16px">Email: <strong>${username}</strong></p>`;
  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;color:#111111;background:#ffffff;max-width:560px;margin:0 auto;padding:24px;line-height:1.5">',
    `<h1 style="font-size:30px;margin:0 0 16px">${copy.heading}</h1>`,
    `<p style="font-size:22px;margin:0 0 16px">${copy.body}</p>`,
    user,
    `<p style="font-size:32px;font-weight:bold;letter-spacing:4px;margin:0 0 24px">${code}</p>`,
    '<p style="font-size:18px;color:#444444;margin:0">All Play: games you can play with your voice.</p>',
    "</div>",
  ].join("");
  return { subject: copy.subject, html };
}

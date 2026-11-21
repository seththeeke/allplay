import { describe, expect, it, vi } from "vitest";
import { createCustomMessageHandler } from "../../../src/controller/cognito/customMessage";
import { renderEmail } from "../../../src/controller/cognito/templates/emailTemplates";
import { createLogger } from "../../../src/logger";

const handler = createCustomMessageHandler(createLogger({ write: vi.fn() }));
const event = (
  triggerSource: string,
  request: Record<string, unknown> = { codeParameter: "{####}" },
) => ({
  version: "1",
  triggerSource,
  userPoolId: "us-east-1_x",
  request: { userAttributes: { email: "pat@example.com" }, ...request },
  response: { smsMessage: null, emailMessage: null, emailSubject: null },
});

type Result = { response: { emailSubject?: string; emailMessage?: string }; userPoolId: string };

describe("custom message trigger", () => {
  it("renders every email kind with Cognito's code placeholder in 32 px type", async () => {
    for (const [source, subject] of [
      ["CustomMessage_SignUp", "Your All Play code"],
      ["CustomMessage_ResendCode", "Your All Play code"],
      ["CustomMessage_ForgotPassword", "Reset your All Play password"],
      ["CustomMessage_UpdateUserAttribute", "Confirm your All Play email"],
      ["CustomMessage_VerifyUserAttribute", "Confirm your All Play email"],
    ] as const) {
      const result = (await handler(event(source))) as Result;
      expect(result.response.emailSubject).toBe(subject);
      expect(result.response.emailMessage).toContain("font-size:32px");
      expect(result.response.emailMessage).toContain("{####}");
      expect(result.userPoolId).toBe("us-east-1_x");
    }
  });

  it("includes the username placeholder for an admin-created user", async () => {
    const result = (await handler(
      event("CustomMessage_AdminCreateUser", {
        codeParameter: "{####}",
        usernameParameter: "{username}",
      }),
    )) as Result;
    expect(result.response.emailMessage).toContain("{username}");
    expect(result.response.emailMessage).toContain("{####}");
    const noUser = (await handler(event("CustomMessage_AdminCreateUser"))) as Result;
    expect(noUser.response.emailMessage).not.toContain("Email:");
  });

  it("leaves other sources and code-less events to Cognito's defaults, and refuses malformed events", async () => {
    const other = event("CustomMessage_Authentication");
    expect(await handler(other)).toEqual(other);
    const noCode = event("CustomMessage_SignUp", { codeParameter: null });
    expect(await handler(noCode)).toEqual(noCode);
    await expect(handler({ nope: true })).rejects.toThrow();
  });

  it("keeps the templates plain and readable", () => {
    const email = renderEmail("FORGOT_PASSWORD", "123456");
    expect(email.html).toContain("font-size:22px");
    expect(email.html).not.toMatch(/<img|<script/);
  });
});

import { describe, expect, it, vi } from "vitest";

describe("custom message Lambda entry", () => {
  it("exports a handler that renders the sign-up email", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const { handler } = await import("../../../src/controller/cognito/customMessageHandler");
    const result = (await handler({
      triggerSource: "CustomMessage_SignUp",
      request: { codeParameter: "{####}" },
      response: {},
    })) as { response: { emailSubject: string } };
    expect(result.response.emailSubject).toBe("Your All Play code");
    vi.restoreAllMocks();
  });
});

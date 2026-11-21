import { describe, expect, it, vi } from "vitest";
import { createPostAuthenticationHandler } from "../../../src/controller/cognito/postAuthentication";
import {
  createPostConfirmationHandler,
  signInOf,
} from "../../../src/controller/cognito/postConfirmation";
import { createPreSignUpHandler } from "../../../src/controller/cognito/preSignUp";
import {
  ACCOUNT_LINKED,
  federatedIdentity,
  TriggerEventSchema,
  USE_SOCIAL_SIGN_IN,
} from "../../../src/controller/cognito/triggerEvent";
import { createInMemoryPlayerDao } from "../../../src/dao/player/inMemoryPlayerDao";
import { createLogger, type LogLevel } from "../../../src/logger";
import {
  createAccountService,
  type AccountService,
} from "../../../src/service/player/accountService";
import type { IdentityService } from "../../../src/service/player/identityService";

function logs() {
  const lines: { level: LogLevel; entry: Record<string, unknown> }[] = [];
  const logger = createLogger({
    write: (level, line) => {
      lines.push({ level, entry: JSON.parse(line) as Record<string, unknown> });
    },
  });
  return { logger, lines };
}

function identities(
  overrides: Partial<IdentityService> = {},
): IdentityService & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    emailInUse: () => Promise.resolve(false),
    linkTarget: () => Promise.resolve(null),
    link: (_p, dest, provider, id) => {
      calls.push(`link ${dest} ${provider} ${id}`);
      return Promise.resolve();
    },
    addToGroup: (_p, user, group) => {
      calls.push(`group ${user} ${group}`);
      return Promise.resolve();
    },
    deleteUserBySub: () => Promise.resolve(),
    signOutBySub: () => Promise.resolve(),
    playerIdForApple: () => Promise.resolve(null),
    mergeUsers: () => Promise.resolve([]),
    ...overrides,
  };
}

const event = (
  triggerSource: string,
  userName: string,
  userAttributes: Record<string, string>,
) => ({
  version: "1",
  triggerSource,
  userPoolId: "us-east-1_pool",
  userName,
  request: { userAttributes },
  response: {},
});

describe("pre sign-up trigger", () => {
  it("refuses a password sign-up for an email that already has a user", async () => {
    const { logger } = logs();
    const taken = createPreSignUpHandler({
      identities: identities({ emailInUse: () => Promise.resolve(true) }),
      logger,
    });
    await expect(
      taken(event("PreSignUp_SignUp", "u1", { email: "pat@example.com" })),
    ).rejects.toThrow(USE_SOCIAL_SIGN_IN);
    const free = createPreSignUpHandler({ identities: identities(), logger });
    const ok = event("PreSignUp_SignUp", "u1", { email: "pat@example.com" });
    expect(await free(ok)).toMatchObject({ triggerSource: "PreSignUp_SignUp" });
    expect(await free(event("PreSignUp_SignUp", "u1", {}))).toMatchObject({ userName: "u1" });
    expect(
      await free(event("PreSignUp_AdminCreateUser", "u1", { email: "x@e.com" })),
    ).toMatchObject({ userName: "u1" });
  });

  it("links a federated identity to the existing user, then asks the client to retry", async () => {
    const { logger, lines } = logs();
    const service = identities({ linkTarget: () => Promise.resolve("native-user") });
    const handler = createPreSignUpHandler({ identities: service, logger });
    await expect(
      handler(
        event("PreSignUp_ExternalProvider", "Google_123", {
          email: "pat@example.com",
          email_verified: "true",
        }),
      ),
    ).rejects.toThrow(ACCOUNT_LINKED);
    expect(service.calls).toEqual(["link native-user Google 123"]);
    expect(lines.at(-1)?.entry["message"]).toBe("Linked a federated identity to an existing user");
  });

  it("auto-confirms federated sign-ups with nothing to link, and continues when a link fails", async () => {
    const { logger, lines } = logs();
    const none = createPreSignUpHandler({ identities: identities(), logger });
    expect(
      await none(
        event("PreSignUp_ExternalProvider", "SignInWithApple_abc", {
          email: "a@b.com",
          email_verified: "true",
        }),
      ),
    ).toMatchObject({ response: { autoConfirmUser: true, autoVerifyEmail: true } });
    expect(
      await none(
        event("PreSignUp_ExternalProvider", "Google_1", {
          email: "a@b.com",
          email_verified: "false",
        }),
      ),
    ).toMatchObject({ response: { autoConfirmUser: true, autoVerifyEmail: false } });
    expect(
      await none(
        event("PreSignUp_ExternalProvider", "Facebook_1", {
          email: "a@b.com",
          email_verified: "true",
        }),
      ),
    ).toMatchObject({
      response: { autoConfirmUser: true },
    });
    const failing = createPreSignUpHandler({
      identities: identities({
        linkTarget: () => Promise.resolve("native"),
        link: () => Promise.reject(new Error("cannot link")),
      }),
      logger,
    });
    expect(
      await failing(
        event("PreSignUp_ExternalProvider", "Google_1", {
          email: "a@b.com",
          email_verified: "true",
        }),
      ),
    ).toMatchObject({ response: { autoConfirmUser: true } });
    expect(lines.at(-1)?.entry).toMatchObject({ level: "WARN", metric: "DUPLICATE_ACCOUNT" });
    expect(await none(event("PreSignUp_Other", "u", {}))).toMatchObject({
      triggerSource: "PreSignUp_Other",
    });
    await expect(none({ nope: true })).rejects.toThrow();
  });
});

describe("federated identity", () => {
  it("reads the identities attribute first, then the federated username", () => {
    const parse = (userName: string, attributes: Record<string, string> = {}) =>
      federatedIdentity(TriggerEventSchema.parse(event("x", userName, attributes)));
    expect(
      parse("u", { identities: JSON.stringify([{ providerName: "Google", userId: "g9" }]) }),
    ).toEqual({
      providerName: "Google",
      userId: "g9",
    });
    expect(parse("signinwithapple_000.abc")).toEqual({
      providerName: "SignInWithApple",
      userId: "000.abc",
    });
    expect(parse("Google_")).toBeNull();
    expect(parse("plainuser")).toBeNull();
    expect(parse("_x")).toBeNull();
    expect(
      parse("Facebook_1", {
        identities: JSON.stringify([{ providerName: "Facebook", userId: "1" }]),
      }),
    ).toBeNull();
  });
});

describe("post confirmation trigger", () => {
  it("adds the user to PLAYER and creates the account player", async () => {
    const players = createInMemoryPlayerDao();
    const service = identities();
    const { logger } = logs();
    const handler = createPostConfirmationHandler({
      identities: service,
      accounts: createAccountService({ players }),
      logger,
    });
    await handler(
      event("PostConfirmation_ConfirmSignUp", "Google_7", {
        sub: "sub-7",
        email: "pat@example.com",
        name: "Pat",
      }),
    );
    expect(service.calls).toEqual(["group Google_7 PLAYER"]);
    expect(await players.get("ACCT#sub-7")).toMatchObject({
      displayName: "Pat",
      signInProviders: ["GOOGLE"],
    });
    await handler(
      event("PostConfirmation_ConfirmForgotPassword", "u", { sub: "s", email: "e@e.com" }),
    );
    expect(service.calls).toHaveLength(1);
  });

  it("logs instead of failing confirmation", async () => {
    const { logger, lines } = logs();
    const handler = createPostConfirmationHandler({
      identities: identities({ addToGroup: () => Promise.reject(new Error("throttled")) }),
      accounts: {} as AccountService,
      logger,
    });
    await handler(event("PostConfirmation_ConfirmSignUp", "u", { sub: "s", email: "e@e.com" }));
    expect(lines.at(-1)).toMatchObject({ level: "ERROR" });
    const noEmail = createPostConfirmationHandler({
      identities: identities(),
      accounts: {} as AccountService,
      logger,
    });
    await noEmail(event("PostConfirmation_ConfirmSignUp", "u", { sub: "s" }));
    expect(lines.at(-1)?.entry["message"]).toBe(
      "Confirmed user has no sub or email; no player created",
    );
  });
});

describe("post authentication trigger", () => {
  it("records the sign-in and logs duplicates, never failing", async () => {
    const { logger, lines } = logs();
    const accounts: AccountService = {
      ensureAccount: vi.fn(),
      recordSignIn: vi.fn(() => Promise.resolve({ duplicates: ["ACCT#old"] })),
    };
    const handler = createPostAuthenticationHandler({ accounts, logger });
    await handler(event("PostAuthentication_Authentication", "u", { sub: "s", email: "e@e.com" }));
    expect(lines.at(-1)?.entry).toMatchObject({
      metric: "DUPLICATE_ACCOUNT",
      playerId: "ACCT#s",
      duplicates: ["ACCT#old"],
    });
    const quiet = createPostAuthenticationHandler({
      accounts: { ...accounts, recordSignIn: () => Promise.resolve({ duplicates: [] }) },
      logger,
    });
    const count = lines.length;
    await quiet(
      event("PostAuthentication_Authentication", "u", { sub: "s", email: "e@e.com", name: "" }),
    );
    expect(lines).toHaveLength(count);
    const failing = createPostAuthenticationHandler({
      accounts: { ...accounts, recordSignIn: () => Promise.reject(new Error("down")) },
      logger,
    });
    await failing(event("PostAuthentication_Authentication", "u", { sub: "s", email: "e@e.com" }));
    expect(lines.at(-1)?.level).toBe("ERROR");
    expect(await failing(event("PostAuthentication_Authentication", "u", {}))).toMatchObject({
      userName: "u",
    });
    expect(signInOf(TriggerEventSchema.parse(event("x", "u", { sub: "s", email: "" })))).toBeNull();
  });
});

describe("trigger Lambda entry points", () => {
  it("exports the three handlers", async () => {
    const entry = await import("../../../src/controller/cognito/accountTriggerHandlers");
    expect([
      typeof entry.preSignUp,
      typeof entry.postConfirmation,
      typeof entry.postAuthentication,
    ]).toEqual(["function", "function", "function"]);
  });
});

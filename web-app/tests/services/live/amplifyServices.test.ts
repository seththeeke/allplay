import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  confirmSignUp: vi.fn(),
  autoSignIn: vi.fn(),
  signInWithRedirect: vi.fn(),
  resetPassword: vi.fn(),
  confirmResetPassword: vi.fn(),
  signOut: vi.fn(),
  fetchAuthSession: vi.fn(),
}));
const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), del: vi.fn(), post: vi.fn() }));
const configure = vi.hoisted(() => vi.fn());
vi.mock("aws-amplify/auth", () => auth);
vi.mock("aws-amplify/api", () => api);
vi.mock("aws-amplify", () => ({ Amplify: { configure } }));

import {
  accountMessage,
  cognitoConfigOf,
  configureAmplify,
  createAmplifyPlayerService,
  createAmplifyAdminService,
  createAmplifyApiClient,
  createAmplifyMergeApi,
  createAmplifyPreferencesService,
  localAuthHeaders,
  PENDING_PROVIDER_KEY,
  retryLinkedSignIn,
} from "../../../src/services/live/amplifyServices";
import { DEFAULT_APP_PREFERENCES, GamesResponseSchema } from "../../../src/models/api";
import { ApiRequestError } from "../../../src/services/errors";

const CONFIG = {
  stage: "TEST" as const,
  dataMode: "MEMORY" as const,
  region: "us-east-1",
  apiUrl: "https://api.example.com/",
  userPoolId: "us-east-1_pool",
  userPoolClientId: "client",
  identityPoolId: "us-east-1:pool",
  oauthDomain: "allplay-test-x.auth.us-east-1.amazoncognito.com",
};
const ME = { playerId: "GUEST#g", kind: "GUEST", tier: "GUEST", displayName: null, email: null };
const reply = (body: unknown) => ({
  response: Promise.resolve({ body: { json: () => Promise.resolve(body) } }),
});

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation(({ path }: { path: string }) =>
    reply(path.endsWith("/preferences") ? { app: DEFAULT_APP_PREFERENCES, games: {} } : ME),
  );
  api.patch.mockReturnValue(reply({ app: DEFAULT_APP_PREFERENCES, games: {} }));
  api.del.mockReturnValue(reply({}));
  api.post.mockReturnValue(reply({ signedOut: true }));
});

describe("Amplify configuration", () => {
  it("reads the Cognito fields of a stage config and configures auth and the signed API", () => {
    expect(cognitoConfigOf({ stage: "TEST", dataMode: "MEMORY" })).toBeNull();
    const cognito = cognitoConfigOf({ ...CONFIG, socialProviders: ["GOOGLE"] });
    expect(cognito?.socialProviders).toEqual(["GOOGLE"]);
    expect(cognitoConfigOf(CONFIG)?.socialProviders).toEqual([]);
    configureAmplify(cognitoConfigOf(CONFIG) ?? ({} as never), "https://web.example.com");
    expect(configure).toHaveBeenCalledWith(
      expect.objectContaining({
        Auth: {
          Cognito: expect.objectContaining({
            allowGuestAccess: true,
            identityPoolId: "us-east-1:pool",
            loginWith: expect.objectContaining({
              oauth: expect.objectContaining({
                redirectSignIn: ["https://web.example.com/"],
                responseType: "code",
              }) as unknown,
            }) as unknown,
          }) as unknown,
        },
        API: { REST: { AllPlay: { endpoint: "https://api.example.com", region: "us-east-1" } } },
      }),
    );
  });
});

describe("Amplify player service", () => {
  const service = () => createAmplifyPlayerService(cognitoConfigOf(CONFIG) ?? ({} as never));

  it("signs in with email, then reads the player from the signed API", async () => {
    auth.signIn.mockResolvedValue({ nextStep: { signInStep: "DONE" } });
    expect(await service().signIn("pat@example.com", "Secret123")).toEqual(ME);
    expect(auth.signIn).toHaveBeenCalledWith({
      username: "pat@example.com",
      password: "Secret123",
    });
    expect(api.get).toHaveBeenCalledWith({
      apiName: "AllPlay",
      path: "/v1/players/me",
      options: { headers: {} },
    });
    auth.signIn.mockResolvedValue({ nextStep: { signInStep: "CONFIRM_SIGN_UP" } });
    await expect(service().signIn("pat@example.com")).rejects.toThrow("Confirm your email");
  });

  it("signs up with auto sign-in and confirms with the emailed code", async () => {
    auth.signUp.mockResolvedValue({});
    await service().signUp("pat@example.com", "Secret123");
    expect(auth.signUp).toHaveBeenCalledWith({
      username: "pat@example.com",
      password: "Secret123",
      options: { userAttributes: { email: "pat@example.com" }, autoSignIn: true },
    });
    auth.confirmSignUp.mockResolvedValue({ nextStep: { signUpStep: "COMPLETE_AUTO_SIGN_IN" } });
    await service().confirmSignUp("pat@example.com", "123456");
    expect(auth.autoSignIn).toHaveBeenCalled();
    auth.confirmSignUp.mockResolvedValue({ nextStep: { signUpStep: "DONE" } });
    vi.clearAllMocks();
    api.get.mockReturnValue(reply(ME));
    await service().confirmSignUp("pat@example.com", "123456");
    expect(auth.autoSignIn).not.toHaveBeenCalled();
  });

  it("turns the trigger tokens and Cognito errors into plain words", async () => {
    auth.signUp.mockRejectedValue(
      new Error("PreSignUp failed with error ALLPLAY_USE_SOCIAL_SIGN_IN."),
    );
    await expect(service().signUp("pat@example.com", "Secret123")).rejects.toThrow(
      "signs in with Google or Apple",
    );
    auth.signIn.mockRejectedValue(
      Object.assign(new Error("Incorrect username or password."), {
        name: "NotAuthorizedException",
      }),
    );
    await expect(service().signIn("pat@example.com", "x")).rejects.toThrow("do not match");
    expect(accountMessage(new Error("User is not confirmed.")).message).toContain(
      "Confirm your email",
    );
    expect(accountMessage("plain").message).toBe("plain");
    const other = new Error("Network down");
    expect(accountMessage(other)).toBe(other);
  });

  it("starts a provider redirect, remembering the provider, and never settles", async () => {
    auth.signInWithRedirect.mockResolvedValue(undefined);
    const pending = service().signInWithProvider("APPLE");
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(auth.signInWithRedirect).toHaveBeenCalledWith({ provider: "Apple" });
    expect(sessionStorage.getItem(PENDING_PROVIDER_KEY)).toBe("APPLE");
    expect(settled).toBe(false);
    expect(service().providers).toEqual([]);
  });

  it("resets passwords, signs out globally, and deletes the account", async () => {
    auth.resetPassword.mockResolvedValue({});
    auth.confirmResetPassword.mockResolvedValue(undefined);
    await service().requestPasswordReset("pat@example.com");
    await service().confirmPasswordReset("pat@example.com", "123456", "Secret123");
    expect(auth.confirmResetPassword).toHaveBeenCalledWith({
      username: "pat@example.com",
      confirmationCode: "123456",
      newPassword: "Secret123",
    });
    auth.signOut.mockResolvedValue(undefined);
    await service().signOut();
    expect(auth.signOut).toHaveBeenCalledWith({ global: true });
    expect(api.post).toHaveBeenCalledWith({
      apiName: "AllPlay",
      path: "/v1/players/me/sign-out",
      options: { headers: {} },
    });
    api.post.mockReturnValue({ response: Promise.reject(new Error("guest")) });
    await service().signOut();
    await service().deleteAccount();
    expect(api.del).toHaveBeenCalledWith({
      apiName: "AllPlay",
      path: "/v1/players/me",
      options: { headers: {} },
    });
  });
});

describe("Amplify preferences service", () => {
  it("reads and patches each scope through the signed API", async () => {
    const preferences = createAmplifyPreferencesService();
    expect((await preferences.get()).app).toEqual(DEFAULT_APP_PREFERENCES);
    await preferences.patchApp({ zoomLevel: 2 });
    await preferences.patchGame("spider-solitaire", { helpSeen: true });
    expect(api.patch).toHaveBeenCalledWith({
      apiName: "AllPlay",
      path: "/v1/players/me/preferences/APP",
      options: { body: { zoomLevel: 2 }, headers: {} },
    });
    expect(api.patch).toHaveBeenLastCalledWith({
      apiName: "AllPlay",
      path: "/v1/players/me/preferences/GAME%23spider-solitaire",
      options: { body: { helpSeen: true }, headers: {} },
    });
  });
});

describe("linked sign-in retry", () => {
  const storage = (provider: string | null) => ({
    getItem: vi.fn(() => provider),
    removeItem: vi.fn(),
  });

  it("retries the same provider once after ALLPLAY_ACCOUNT_LINKED", async () => {
    const redirect = vi.fn(() => Promise.resolve());
    const linked = {
      search: "?error_description=PreSignUp+failed+with+error+ALLPLAY_ACCOUNT_LINKED.",
    };
    expect(await retryLinkedSignIn(linked, storage("GOOGLE"), redirect)).toBe(true);
    expect(redirect).toHaveBeenCalledWith("GOOGLE");
    expect(await retryLinkedSignIn({ search: "" }, storage("GOOGLE"), redirect)).toBe(false);
    expect(await retryLinkedSignIn(linked, storage(null), redirect)).toBe(false);
    auth.signInWithRedirect.mockResolvedValue(undefined);
    expect(await retryLinkedSignIn(linked, storage("APPLE"))).toBe(true);
    expect(auth.signInWithRedirect).toHaveBeenCalledWith({ provider: "Apple" });
  });
});

describe("local Cognito headers", () => {
  it("send the ID token when signed in, else the guest identity, else nothing", async () => {
    auth.fetchAuthSession.mockResolvedValueOnce({
      tokens: { idToken: { toString: () => "id-token" } },
    });
    expect(await localAuthHeaders()).toEqual({ authorization: "Bearer id-token" });
    auth.fetchAuthSession.mockResolvedValueOnce({ identityId: "us-east-1:guest" });
    expect(await localAuthHeaders()).toEqual({ "x-allplay-identity-id": "us-east-1:guest" });
    auth.fetchAuthSession.mockResolvedValueOnce({});
    expect(await localAuthHeaders()).toEqual({});
  });

  it("are sent on every player and preferences call", async () => {
    const headers = () => Promise.resolve({ authorization: "Bearer t" });
    const player = createAmplifyPlayerService(cognitoConfigOf(CONFIG) ?? ({} as never), headers);
    await player.me();
    expect(api.get).toHaveBeenLastCalledWith(
      expect.objectContaining({ options: { headers: { authorization: "Bearer t" } } }),
    );
    await createAmplifyPreferencesService(headers).get();
    expect(api.get).toHaveBeenLastCalledWith(
      expect.objectContaining({ options: { headers: { authorization: "Bearer t" } } }),
    );
  });
});

describe("Amplify admin service", () => {
  it("lists and starts deployments through the signed API", async () => {
    api.get.mockReturnValue(reply({ deployments: [] }));
    api.post.mockReturnValue(reply({ executionId: "e-1" }));
    const admin = createAmplifyAdminService();
    expect(await admin.deployments()).toEqual({ deployments: [] });
    expect(api.get).toHaveBeenLastCalledWith({
      apiName: "AllPlay",
      path: "/v1/admin/deployments",
      options: { headers: {} },
    });
    expect(await admin.startDeployment()).toEqual({ executionId: "e-1" });
    expect(api.post).toHaveBeenLastCalledWith({
      apiName: "AllPlay",
      path: "/v1/admin/deployments",
      options: { headers: {} },
    });
    api.get.mockReturnValue(reply({ days: [] }));
    expect(await admin.metrics("2026-11-01", "2026-11-21")).toEqual({ days: [] });
    expect(api.get).toHaveBeenLastCalledWith({
      apiName: "AllPlay",
      path: "/v1/admin/metrics",
      options: { headers: {}, queryParams: { from: "2026-11-01", to: "2026-11-21" } },
    });
    api.get.mockReturnValue(reply({ decisions: [] }));
    expect(await admin.failures("2026-11-21")).toEqual({ decisions: [] });
    expect(api.get).toHaveBeenLastCalledWith({
      apiName: "AllPlay",
      path: "/v1/admin/decisions",
      options: { headers: {}, queryParams: { day: "2026-11-21" } },
    });
    api.get.mockReturnValue(reply({ duplicates: [] }));
    expect(await admin.duplicates()).toEqual({ duplicates: [] });
    api.post.mockReturnValue(reply({ primaryPlayerId: "ACCT#a", mergedPlayerId: "ACCT#b" }));
    await admin.mergeAccounts("ACCT#a", "ACCT#b");
    expect(api.post).toHaveBeenLastCalledWith({
      apiName: "AllPlay",
      path: "/v1/admin/players/merge",
      options: { headers: {}, body: { primaryPlayerId: "ACCT#a", duplicatePlayerId: "ACCT#b" } },
    });
  });
});

describe("Amplify merge API", () => {
  it("issues and redeems tokens through the signed API", async () => {
    const merge = createAmplifyMergeApi();
    api.post.mockReturnValueOnce(
      reply({ token: "t".repeat(43), expiresAt: "2026-11-21T12:10:00.000Z" }),
    );
    expect((await merge.issue()).token).toHaveLength(43);
    expect(api.post).toHaveBeenLastCalledWith({
      apiName: "AllPlay",
      path: "/v1/players/me/merge-tokens",
      options: { headers: {} },
    });
    api.post.mockReturnValue(reply({ primaryPlayerId: "ACCT#a", mergedPlayerId: "GUEST#g" }));
    await merge.redeem("t".repeat(43));
    expect(api.post).toHaveBeenLastCalledWith({
      apiName: "AllPlay",
      path: "/v1/players/me/merge",
      options: { headers: {}, body: { token: "t".repeat(43) } },
    });
    await merge.redeem("t".repeat(43), "SOURCE");
    expect(api.post).toHaveBeenLastCalledWith(
      expect.objectContaining({
        options: { headers: {}, body: { token: "t".repeat(43), keep: "SOURCE" } },
      }),
    );
  });
});

describe("Amplify API client", () => {
  const failed = (statusCode: number | undefined, body?: string) => ({
    response: Promise.reject(
      Object.assign(
        new Error("failed"),
        statusCode === undefined ? {} : { response: { statusCode, body } },
      ),
    ),
  });

  it("signs gets with their query as parameters, and posts JSON bodies", async () => {
    const client = createAmplifyApiClient(() => Promise.resolve({ authorization: "x" }));
    api.get.mockReturnValue(reply({ games: [] }));
    expect(await client.get("v1/games", GamesResponseSchema)).toEqual({ games: [] });
    expect(api.get).toHaveBeenLastCalledWith({
      apiName: "AllPlay",
      path: "/v1/games",
      options: { headers: { authorization: "x" } },
    });
    await client.get("v1/sessions/current?gameId=spider-solitaire", GamesResponseSchema);
    expect(api.get).toHaveBeenLastCalledWith({
      apiName: "AllPlay",
      path: "/v1/sessions/current",
      options: { headers: { authorization: "x" }, queryParams: { gameId: "spider-solitaire" } },
    });
    api.post.mockReturnValue(reply({ games: [] }));
    await createAmplifyApiClient().post("v1/sessions", { gameId: "g" }, GamesResponseSchema);
    expect(api.post).toHaveBeenLastCalledWith({
      apiName: "AllPlay",
      path: "/v1/sessions",
      options: { headers: {}, body: { gameId: "g" } },
    });
  });

  it("patches through the signed API", async () => {
    api.patch.mockReturnValue(reply({ games: [] }));
    await createAmplifyApiClient().patch("v1/x", { a: 1 }, GamesResponseSchema);
    expect(api.patch).toHaveBeenLastCalledWith({
      apiName: "AllPlay",
      path: "/v1/x",
      options: { headers: {}, body: { a: 1 } },
    });
  });

  it("turns API errors into ApiRequestError, keeping the error body", async () => {
    const client = createAmplifyApiClient();
    api.get.mockReturnValueOnce(
      failed(409, JSON.stringify({ code: "VERSION_CONFLICT", message: "Stale." })),
    );
    const conflict = await client
      .get("v1/games", GamesResponseSchema)
      .catch((error: unknown) => error);
    expect(conflict).toBeInstanceOf(ApiRequestError);
    expect(conflict).toMatchObject({ status: 409, body: { code: "VERSION_CONFLICT" } });
    api.get.mockReturnValueOnce(failed(502, "<html>"));
    await expect(client.get("v1/games", GamesResponseSchema)).rejects.toMatchObject({
      status: 502,
      body: { code: "INTERNAL_ERROR", message: "The server answered 502." },
    });
    api.get.mockReturnValueOnce(failed(500));
    await expect(client.get("v1/games", GamesResponseSchema)).rejects.toMatchObject({
      status: 500,
    });
    api.get.mockReturnValueOnce(failed(undefined));
    await expect(client.get("v1/games", GamesResponseSchema)).rejects.toThrow("failed");
  });
});

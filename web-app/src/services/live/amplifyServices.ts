import { Amplify } from "aws-amplify";
import { del, get, patch, post, put } from "aws-amplify/api";
import {
  autoSignIn,
  confirmResetPassword,
  confirmSignIn,
  fetchAuthSession,
  confirmSignUp,
  resetPassword,
  signIn,
  signInWithRedirect,
  signOut,
  signUp,
} from "aws-amplify/auth";
import type { AppConfig } from "../../config";
import {
  ApiErrorSchema,
  MergeResponseSchema,
  MergeTokenResponseSchema,
  PlayerMeSchema,
  PreferencesResponseSchema,
  type PlayerMe,
} from "../../models/api";
import type { AdminService, PlayerService, PreferencesService, SignInProvider } from "../types";
import type { z } from "zod";
import { ApiRequestError, NewPasswordRequiredError } from "../errors";
import { pauseSignal, type PauseSignal } from "../pauseSignal";
import type { ApiClient } from "./apiClient";
import { createLiveAdminService } from "./liveAdminService";
import type { AwsCredentials } from "../../voice/awsVoice";
import type { MergeApi } from "./guestMerge";

/** The config fields Amplify needs; present on deployed stages from AA-1 and AA-4. */
export interface CognitoConfig {
  region: string;
  apiUrl: string;
  userPoolId: string;
  userPoolClientId: string;
  identityPoolId: string;
  oauthDomain: string;
  socialProviders: SignInProvider[];
  /** No guest credentials and no sign-up (productionalization.md section 3). */
  inviteOnly: boolean;
}

/** The Cognito settings of a stage config, or null when it has none (memory and local modes). */
export function cognitoConfigOf(config: AppConfig): CognitoConfig | null {
  const { region, apiUrl, userPoolId, userPoolClientId, identityPoolId, oauthDomain } = config;
  if (
    region === undefined ||
    apiUrl === undefined ||
    userPoolId === undefined ||
    userPoolClientId === undefined ||
    identityPoolId === undefined ||
    oauthDomain === undefined
  )
    return null;
  return {
    region,
    apiUrl,
    userPoolId,
    userPoolClientId,
    identityPoolId,
    oauthDomain,
    socialProviders: config.socialProviders ?? [],
    inviteOnly: config.accessMode === "INVITE_ONLY",
  };
}

const API = "AllPlay";
/** Where the provider of a pending redirect sign-in is kept, so a linked sign-in can be retried. */
export const PENDING_PROVIDER_KEY = "allplay.pendingProvider";
const AMPLIFY_PROVIDERS = { GOOGLE: "Google", APPLE: "Apple" } as const;

/**
 * Configures Amplify for the stage (authn-authz.md section 7.1): the User
 * Pool with the managed login domain for Google and Apple, the Identity Pool
 * with guest access, and the API, whose calls Amplify signs with SigV4.
 */
export function configureAmplify(config: CognitoConfig, origin: string): void {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: config.userPoolId,
        userPoolClientId: config.userPoolClientId,
        identityPoolId: config.identityPoolId,
        allowGuestAccess: !config.inviteOnly,
        signUpVerificationMethod: "code",
        loginWith: {
          email: true,
          oauth: {
            domain: config.oauthDomain,
            scopes: ["openid", "email", "profile"],
            redirectSignIn: [`${origin}/`],
            redirectSignOut: [`${origin}/`],
            responseType: "code",
          },
        },
      },
    },
    API: { REST: { [API]: { endpoint: config.apiUrl.replace(/\/$/, ""), region: config.region } } },
  });
}

/** Stable tokens from the sign-up triggers (authn-authz.md section 3.2), turned into plain words. */
export function accountMessage(failure: unknown): Error {
  const text = failure instanceof Error ? failure.message : String(failure);
  if (text.includes("ALLPLAY_INVITE_ONLY"))
    return new Error("This stage is invite only. Ask the owner for an invitation.");
  if (text.includes("ALLPLAY_USE_SOCIAL_SIGN_IN"))
    return new Error("This email signs in with Google or Apple. Use one of those buttons instead.");
  if (/UserNotConfirmed/i.test(text) || /not confirmed/i.test(text))
    return new Error("Confirm your email with the code we sent before signing in.");
  if (/NotAuthorized|Incorrect username or password/i.test(text))
    return new Error("That email and password do not match.");
  return failure instanceof Error ? failure : new Error(text);
}

/** Extra headers for each call; the local server's `cognito-test` auth reads them instead of a signature. */
export type CallHeaders = () => Promise<Record<string, string>>;

/**
 * The caller for the local server under `cognito-test` (authn-authz.md
 * section 11): the Test ID token when signed in, else the guest's Test
 * Identity Pool identity. A bearer header also stops Amplify from signing.
 */
export const localAuthHeaders: CallHeaders = async () => {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  if (token !== undefined) return { authorization: `Bearer ${token}` };
  return session.identityId === undefined ? {} : { "x-allplay-identity-id": session.identityId };
};

const none: CallHeaders = () => Promise.resolve({});

/** The JSON body of a signed API call. */
async function json(call: {
  response: Promise<{ body: { json: () => Promise<unknown> } }>;
}): Promise<unknown> {
  return (await call.response).body.json();
}

/** The visitor of an invite-only stage before signing in; never sent to the API. */
export const SIGNED_OUT: PlayerMe = {
  playerId: "SIGNED_OUT",
  kind: "GUEST",
  tier: "GUEST",
  displayName: null,
  email: null,
};

/** Player and account flows over Cognito with Amplify (authn-authz.md section 7.1). */
export function createAmplifyPlayerService(
  config: CognitoConfig,
  headers: CallHeaders = none,
): PlayerService {
  const me = async (): Promise<PlayerMe> => {
    /* With no guests, a signed-out visitor has no credentials to call the API with. */
    if (config.inviteOnly && (await fetchAuthSession()).tokens === undefined) return SIGNED_OUT;
    return PlayerMeSchema.parse(
      await json(
        get({ apiName: API, path: "/v1/players/me", options: { headers: await headers() } }),
      ),
    );
  };
  const guarded = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (failure) {
      throw accountMessage(failure);
    }
  };
  return {
    providers: config.socialProviders,
    inviteOnly: config.inviteOnly,
    me,
    signIn: (email, password) =>
      guarded(async () => {
        const result = await signIn({ username: email, password: password ?? "" });
        if (result.nextStep.signInStep === "CONFIRM_SIGN_UP")
          throw new Error("Confirm your email with the code we sent before signing in.");
        if (result.nextStep.signInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED")
          throw new NewPasswordRequiredError();
        return me();
      }),
    completeNewPassword: (newPassword) =>
      guarded(async () => {
        await confirmSignIn({ challengeResponse: newPassword });
        return me();
      }),
    signInWithProvider: async (provider) => {
      sessionStorage.setItem(PENDING_PROVIDER_KEY, provider);
      await signInWithRedirect({ provider: AMPLIFY_PROVIDERS[provider] });
      /* The browser is leaving for the provider; this call never settles. */
      return new Promise<PlayerMe>(() => undefined);
    },
    signUp: (email, password) =>
      guarded(async () => {
        await signUp({
          username: email,
          password,
          options: { userAttributes: { email }, autoSignIn: true },
        });
      }),
    confirmSignUp: (email, code) =>
      guarded(async () => {
        const result = await confirmSignUp({ username: email, confirmationCode: code });
        if (result.nextStep.signUpStep === "COMPLETE_AUTO_SIGN_IN") await autoSignIn();
        return me();
      }),
    requestPasswordReset: (email) =>
      guarded(async () => {
        await resetPassword({ username: email });
      }),
    confirmPasswordReset: (email, code, newPassword) =>
      guarded(() => confirmResetPassword({ username: email, confirmationCode: code, newPassword })),
    signOut: async () => {
      /* The server records the sign-out and revokes refresh tokens everywhere (authn-authz.md section 12). */
      const signOutHeaders = await headers();
      await post({
        apiName: API,
        path: "/v1/players/me/sign-out",
        options: { headers: signOutHeaders },
      }).response.catch(() => undefined);
      await signOut({ global: true });
      return me();
    },
    /* The link token is issued by withGuestMerge; here only this device signs out. */
    startLink: async () => {
      await signOut();
      return me();
    },
    deleteAccount: async () => {
      await del({ apiName: API, path: "/v1/players/me", options: { headers: await headers() } })
        .response;
      await signOut();
      return me();
    },
  };
}

/** Preferences over the signed API (authn-authz.md section 5). */
export function createAmplifyPreferencesService(headers: CallHeaders = none): PreferencesService {
  const scoped = async (scope: string, body: object) =>
    PreferencesResponseSchema.parse(
      await json(
        patch({
          apiName: API,
          path: `/v1/players/me/preferences/${encodeURIComponent(scope)}`,
          options: { body: body as Record<string, string>, headers: await headers() },
        }),
      ),
    );
  return {
    get: async () =>
      PreferencesResponseSchema.parse(
        await json(
          get({
            apiName: API,
            path: "/v1/players/me/preferences",
            options: { headers: await headers() },
          }),
        ),
      ),
    patchApp: (changes) => scoped("APP", changes),
    patchGame: (gameId, changes) => scoped(`GAME#${gameId}`, changes),
  };
}

/** The merge routes over the signed API (authn-authz.md section 6). */
export function createAmplifyMergeApi(headers: CallHeaders = none): MergeApi {
  return {
    issue: async () =>
      MergeTokenResponseSchema.parse(
        await json(
          post({
            apiName: API,
            path: "/v1/players/me/merge-tokens",
            options: { headers: await headers() },
          }),
        ),
      ),
    redeem: async (token, keep) =>
      MergeResponseSchema.parse(
        await json(
          post({
            apiName: API,
            path: "/v1/players/me/merge",
            options: {
              headers: await headers(),
              body: keep === undefined ? { token } : { token, keep },
            },
          }),
        ),
      ),
  };
}

/** The admin API over the signed API (authn-authz.md section 5). */
export function createAmplifyAdminService(headers: CallHeaders = none): AdminService {
  return createLiveAdminService(createAmplifyApiClient(headers));
}

/**
 * After a Google or Apple sign-in returns, the pre sign-up trigger may have
 * linked it to an existing user and refused this first attempt with
 * ALLPLAY_ACCOUNT_LINKED (authn-authz.md section 3.2). Retries the same
 * provider once; returns true when it did.
 */
export async function retryLinkedSignIn(
  location: Pick<Location, "search">,
  storage: Pick<Storage, "getItem" | "removeItem">,
  redirect: (provider: SignInProvider) => Promise<void> = (provider) =>
    signInWithRedirect({ provider: AMPLIFY_PROVIDERS[provider] }),
): Promise<boolean> {
  const description = new URLSearchParams(location.search).get("error_description") ?? "";
  const provider = storage.getItem(PENDING_PROVIDER_KEY);
  storage.removeItem(PENDING_PROVIDER_KEY);
  if (!description.includes("ALLPLAY_ACCOUNT_LINKED")) return false;
  if (provider !== "GOOGLE" && provider !== "APPLE") return false;
  await redirect(provider);
  return true;
}

/** An Amplify REST call's error response, when the API answered. */
interface AmplifyFailure {
  response?: { statusCode?: number; body?: string };
}

/**
 * The ApiClient over Amplify's signed REST calls, for the game, session,
 * decision and stats routes on deployed stages (WP-1). API errors become
 * ApiRequestError as with the fetch client, so a version conflict still
 * carries the current envelope.
 */
export function createAmplifyApiClient(
  headers: CallHeaders = none,
  paused: PauseSignal = pauseSignal,
): ApiClient {
  const split = (path: string) => {
    const [route = "", query = ""] = path.split("?");
    const queryParams = Object.fromEntries(new URLSearchParams(query));
    return { path: `/${route}`, ...(query === "" ? {} : { queryParams }) };
  };
  const call = async <T extends z.ZodType>(
    schema: T,
    operation: { response: Promise<{ body: { json: () => Promise<unknown> } }> },
  ): Promise<z.output<T>> => {
    try {
      const body = await json(operation);
      paused.set(false);
      return schema.parse(body);
    } catch (failure) {
      const response = (failure as AmplifyFailure).response;
      if (response?.statusCode === undefined) throw failure;
      let body: unknown = null;
      try {
        body = JSON.parse(response.body ?? "");
      } catch {
        body = null;
      }
      const error = ApiErrorSchema.safeParse(body);
      paused.set(error.success && error.data.code === "ANDON_CORD_PULLED");
      throw new ApiRequestError(
        response.statusCode,
        error.success
          ? error.data
          : {
              code: "INTERNAL_ERROR",
              message: `The server answered ${String(response.statusCode)}.`,
            },
      );
    }
  };
  return {
    get: async (path, schema) => {
      const { path: route, queryParams } = split(path);
      return call(
        schema,
        get({
          apiName: API,
          path: route,
          options: {
            headers: await headers(),
            ...(queryParams === undefined ? {} : { queryParams }),
          },
        }),
      );
    },
    post: async (path, body, schema) =>
      call(
        schema,
        post({
          apiName: API,
          path: split(path).path,
          options: { headers: await headers(), body: body as never },
        }),
      ),
    patch: async (path, body, schema) =>
      call(
        schema,
        patch({
          apiName: API,
          path: split(path).path,
          options: { headers: await headers(), body: body as never },
        }),
      ),
    put: async (path, body, schema) =>
      call(
        schema,
        put({
          apiName: API,
          path: split(path).path,
          options: { headers: await headers(), body: body as never },
        }),
      ),
  };
}

/** The Identity Pool credentials Amplify holds for the caller, guest or signed in (action-decision.md section 3.1). */
export const amplifyCredentials = async (): Promise<AwsCredentials> => {
  const { credentials } = await fetchAuthSession();
  if (credentials === undefined) throw new Error("No AWS credentials for voice.");
  return credentials;
};

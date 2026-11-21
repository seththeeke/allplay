import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createCognitoTokenVerifier } from "../../src/local/cognitoTokens";
import { cognitoCaller, createLocalProviders } from "../../src/local/providers";
import { resolveSettings } from "../../src/local/settings";
import { createLogger } from "../../src/logger";

const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const JWK = { ...rsa.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256" };
const SETTINGS = { region: "us-east-1", userPoolId: "us-east-1_pool", userPoolClientId: "client" };
const ISSUER = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_pool";
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

function token(claims: Record<string, unknown>, kid = "k1", key = rsa.privateKey): string {
  const head = b64({ alg: "RS256", kid });
  const body = b64({
    sub: "sub-1",
    iss: ISSUER,
    aud: "client",
    token_use: "id",
    exp: 2_000,
    ...claims,
  });
  return `${head}.${body}.${sign("RSA-SHA256", Buffer.from(`${head}.${body}`), key).toString("base64url")}`;
}

describe("Cognito ID token verification", () => {
  const fetchJson = vi.fn(() => Promise.resolve({ keys: [JWK] }));
  const verifyToken = createCognitoTokenVerifier(SETTINGS, fetchJson, () => 1_000);

  it("accepts a Test pool ID token, with its groups, fetching the keys once", async () => {
    expect(await verifyToken(token({ "cognito:groups": ["ADMIN"] }))).toEqual({
      sub: "sub-1",
      groups: ["ADMIN"],
    });
    expect(await verifyToken(token({}))).toEqual({ sub: "sub-1", groups: [] });
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(fetchJson).toHaveBeenCalledWith(`${ISSUER}/.well-known/jwks.json`);
  });

  it("refuses forged, foreign, expired, access and malformed tokens", async () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    for (const bad of [
      token({}, "k1", other),
      token({}, "unknown"),
      token({ iss: "https://evil" }),
      token({ aud: "other-client" }),
      token({ exp: 10 }),
      token({ token_use: "access" }),
      "not.a.jwt",
      "only-one-part",
    ]) {
      expect(await verifyToken(bad)).toBeNull();
    }
    expect(typeof createCognitoTokenVerifier(SETTINGS)).toBe("function");
  });
});

describe("cognito-test callers", () => {
  const caller = cognitoCaller((value) =>
    Promise.resolve(
      value === "admin"
        ? { sub: "a", groups: ["ADMIN"] }
        : value === "player"
          ? { sub: "p", groups: [] }
          : null,
    ),
  );

  it("maps a verified token, a guest identity, or nothing", async () => {
    expect(await caller({ authorization: "Bearer admin" })).toEqual({ tier: "admin", id: "a" });
    expect(await caller({ authorization: "Bearer player" })).toEqual({ tier: "player", id: "p" });
    expect(
      await caller({
        authorization: "Bearer forged",
        "x-allplay-identity-id": "us-east-1:0a1b-2c",
      }),
    ).toEqual({
      tier: "guest",
      id: "us-east-1:0a1b-2c",
    });
    expect(await caller({ "x-allplay-identity-id": "not an id" })).toEqual({
      tier: "guest",
      id: "local-guest",
    });
    expect(await caller({})).toEqual({ tier: "guest", id: "local-guest" });
  });

  it("is the local-aws-auth preset's auth, and reports whether the Test pool is set", async () => {
    const logger = createLogger({ write: vi.fn() });
    const env = {
      ALLPLAY_PRESET: "local-aws-auth",
      ALLPLAY_LLM: "fake",
      ALLPLAY_SPEECH_IN: "typed",
      ALLPLAY_SPEECH_OUT: "recording",
    };
    expect(resolveSettings(env).auth).toBe("cognito-test");
    const missing = await createLocalProviders(resolveSettings(env), env, { logger });
    expect((await missing.status())["auth"]).toMatchObject({
      setting: "cognito-test",
      available: false,
    });
    expect(await missing.callerOf({ "x-allplay-dev-caller": "admin:x" })).toEqual({
      tier: "admin",
      id: "x",
    });
    const set = {
      ...env,
      ALLPLAY_AUTH_USER_POOL_ID: "us-east-1_pool",
      ALLPLAY_AUTH_CLIENT_ID: "client",
    };
    const ready = await createLocalProviders(resolveSettings(set), set, { logger });
    expect((await ready.status())["auth"]).toMatchObject({
      available: true,
      detail: "Test User Pool us-east-1_pool.",
    });
    expect(await ready.callerOf({ "x-allplay-dev-caller": "admin:x" })).toEqual({
      tier: "guest",
      id: "local-guest",
    });
    const injected = await createLocalProviders(resolveSettings(env), env, {
      logger,
      verifyToken: () => Promise.resolve({ sub: "s", groups: [] }),
    });
    expect(await injected.callerOf({ authorization: "Bearer t" })).toEqual({
      tier: "player",
      id: "s",
    });
    const mock = await createLocalProviders(
      resolveSettings({ ALLPLAY_PRESET: "continuous-integration" }),
      {},
      { logger },
    );
    expect((await mock.status())["auth"]).toMatchObject({ setting: "mock", available: true });
  });
});

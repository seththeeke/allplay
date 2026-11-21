import { generateKeyPairSync, sign, verify } from "node:crypto";
import type { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { describe, expect, it, vi } from "vitest";
import {
  APPLE_ISSUER,
  appleClientSecret,
  createAppleClient,
  type FetchLike,
} from "../../../src/dao/apple/appleClient";
import { createFederationSecretReader } from "../../../src/dao/secrets/federationSecret";

const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
const CREDENTIALS = {
  servicesId: "com.allplay.web",
  teamId: "TEAM123",
  keyId: "KEY123",
  privateKeyPem: ec.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const JWK = {
  ...rsa.publicKey.export({ format: "jwk" }),
  kid: "apple-1",
  alg: "RS256",
  use: "sig",
};
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

function appleJwt(claims: object, kid = "apple-1", key = rsa.privateKey): string {
  const head = b64({ alg: "RS256", kid });
  const body = b64(claims);
  return `${head}.${body}.${sign("RSA-SHA256", Buffer.from(`${head}.${body}`), key).toString("base64url")}`;
}

const reply = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

describe("Apple client secret", () => {
  it("is an ES256 JWT for Apple, signed with the Sign in with Apple key", () => {
    const secret = appleClientSecret(CREDENTIALS, 1_000);
    const [head, body, signature] = secret.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(head, "base64url").toString())).toEqual({
      alg: "ES256",
      kid: "KEY123",
    });
    expect(JSON.parse(Buffer.from(body, "base64url").toString())).toEqual({
      iss: "TEAM123",
      iat: 1_000,
      exp: 1_300,
      aud: APPLE_ISSUER,
      sub: "com.allplay.web",
    });
    expect(
      verify(
        "sha256",
        Buffer.from(`${head}.${body}`),
        { key: ec.publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true);
  });
});

describe("Apple client", () => {
  it("exchanges a fresh code for a refresh token and revokes it", async () => {
    const calls: { url: string; body: string }[] = [];
    const fetchImpl = vi.fn<FetchLike>((url, init) => {
      calls.push({ url, body: init?.body as string });
      return reply(200, url.endsWith("/auth/token") ? { refresh_token: "r-1" } : {});
    });
    await createAppleClient(fetchImpl, () => 1_000).revokeWithCode(CREDENTIALS, "code-1");
    expect(calls.map((c) => c.url)).toEqual([
      `${APPLE_ISSUER}/auth/token`,
      `${APPLE_ISSUER}/auth/revoke`,
    ]);
    expect(new URLSearchParams(calls[0]?.body).get("code")).toBe("code-1");
    expect(new URLSearchParams(calls[1]?.body).get("token")).toBe("r-1");
    expect(new URLSearchParams(calls[1]?.body).get("token_type_hint")).toBe("refresh_token");
    await expect(
      createAppleClient(() => reply(400, { error: "invalid_grant" })).revokeWithCode(
        CREDENTIALS,
        "old",
      ),
    ).rejects.toThrow("answered 400");
    const noJson = createAppleClient((url) =>
      url.endsWith("/auth/token")
        ? reply(200, { refresh_token: "r" })
        : Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.reject(new Error("empty")),
          }),
    );
    await expect(noJson.revokeWithCode(CREDENTIALS, "c")).resolves.toBeUndefined();
  });

  it("verifies a notification against Apple's keys and returns its event", async () => {
    const keys = () => reply(200, { keys: [JWK] });
    const client = createAppleClient(keys, () => 1_000);
    const event = { type: "consent-revoked", sub: "apple-sub", event_time: 1 };
    const claims = {
      iss: APPLE_ISSUER,
      aud: "com.allplay.web",
      exp: 2_000,
      events: JSON.stringify(event),
    };
    expect(await client.verifyNotification(CREDENTIALS, appleJwt(claims))).toEqual(event);
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    for (const [jwt, message] of [
      ["only.two", "Malformed"],
      [appleJwt(claims, "unknown"), "Unknown Apple signing key"],
      [appleJwt(claims, "apple-1", other), "Invalid notification signature"],
      [appleJwt({ ...claims, aud: "someone.else" }), "another app"],
      [appleJwt({ ...claims, exp: 10 }), "Expired"],
    ] as const) {
      await expect(client.verifyNotification(CREDENTIALS, jwt)).rejects.toThrow(message);
    }
    expect(typeof createAppleClient().verifyNotification).toBe("function");
  });
});

describe("federation secret reader", () => {
  const secret = (values: Record<string, string>) => ({
    send: vi.fn<(command: GetSecretValueCommand) => Promise<{ SecretString: string }>>(() =>
      Promise.resolve({ SecretString: JSON.stringify(values) }),
    ),
  });

  it("returns the Apple credentials once set, cached, and null while any is PENDING", async () => {
    const ready = secret({
      appleServicesId: "s",
      appleTeamId: "t",
      appleKeyId: "k",
      applePrivateKeyPem: "pem",
      googleClientId: "PENDING",
    });
    const read = createFederationSecretReader("allplay/test/federation", ready);
    expect(await read()).toEqual({
      servicesId: "s",
      teamId: "t",
      keyId: "k",
      privateKeyPem: "pem",
    });
    await read();
    expect(ready.send).toHaveBeenCalledTimes(1);
    const pending = secret({
      appleServicesId: "PENDING",
      appleTeamId: "t",
      appleKeyId: "k",
      applePrivateKeyPem: "p",
    });
    expect(await createFederationSecretReader("x", pending)()).toBeNull();
    expect(await createFederationSecretReader("x", secret({}))()).toBeNull();
    expect(
      await createFederationSecretReader("x", { send: () => Promise.resolve({}) })(),
    ).toBeNull();
  });

  it("retries after a failed read", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("throttled"))
      .mockResolvedValueOnce({ SecretString: "{}" });
    const read = createFederationSecretReader("x", { send });
    await expect(read()).rejects.toThrow("throttled");
    expect(await read()).toBeNull();
    expect(typeof createFederationSecretReader("x")).toBe("function");
  });
});

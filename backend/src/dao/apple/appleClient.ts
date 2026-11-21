import { createPrivateKey, createPublicKey, sign, verify, type JsonWebKey } from "node:crypto";
import { z } from "zod";
import type { AppleCredentials } from "../secrets/federationSecret";

/** Sign in with Apple's REST endpoints (Apple TN3194). */
export const APPLE_ISSUER = "https://appleid.apple.com";

export type FetchLike = (
  url: string,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

/** One Sign in with Apple server-to-server notification event. */
export const AppleEventSchema = z.object({
  type: z.enum([
    "email-disabled",
    "email-enabled",
    "consent-revoked",
    "account-delete",
    "account-deleted",
  ]),
  sub: z.string().min(1),
  email: z.string().optional(),
  is_private_email: z.union([z.boolean(), z.string()]).optional(),
  event_time: z.number().optional(),
});
export type AppleEvent = z.infer<typeof AppleEventSchema>;

const base64url = (data: Buffer | string): string => Buffer.from(data).toString("base64url");

/**
 * The client secret Apple's token and revoke endpoints take: an ES256 JWT
 * signed with the Sign in with Apple key, valid for five minutes.
 */
export function appleClientSecret(credentials: AppleCredentials, nowSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: "ES256", kid: credentials.keyId }));
  const payload = base64url(
    JSON.stringify({
      iss: credentials.teamId,
      iat: nowSeconds,
      exp: nowSeconds + 300,
      aud: APPLE_ISSUER,
      sub: credentials.servicesId,
    }),
  );
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), {
    key: createPrivateKey(credentials.privateKeyPem),
    dsaEncoding: "ieee-p1363",
  });
  return `${header}.${payload}.${base64url(signature)}`;
}

const JwksSchema = z.object({
  keys: z.array(z.looseObject({ kid: z.string(), kty: z.string() })),
});

/**
 * The parts of Sign in with Apple's REST API All Play uses (authn-authz.md
 * section 12): revoking a user's tokens at account deletion, and verifying
 * the server-to-server notifications Apple signs with its published keys.
 */
export interface AppleClient {
  /** Exchanges a fresh authorization code for a refresh token and revokes it. */
  revokeWithCode(credentials: AppleCredentials, code: string): Promise<void>;
  /** Verifies a notification JWT (RS256, Apple's issuer, our Services ID) and returns its event. */
  verifyNotification(credentials: AppleCredentials, jwt: string): Promise<AppleEvent>;
}

export function createAppleClient(
  fetchImpl: FetchLike = (url, init) => fetch(url, init),
  now: () => number = () => Math.floor(Date.now() / 1000),
): AppleClient {
  const form = async (path: string, fields: Record<string, string>): Promise<unknown> => {
    const response = await fetchImpl(`${APPLE_ISSUER}${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    });
    if (!response.ok) throw new Error(`Apple ${path} answered ${String(response.status)}`);
    return response.json().catch(() => ({}));
  };
  return {
    revokeWithCode: async (credentials, code) => {
      const secret = appleClientSecret(credentials, now());
      const tokens = z.object({ refresh_token: z.string().min(1) }).parse(
        await form("/auth/token", {
          grant_type: "authorization_code",
          code,
          client_id: credentials.servicesId,
          client_secret: secret,
        }),
      );
      await form("/auth/revoke", {
        client_id: credentials.servicesId,
        client_secret: secret,
        token: tokens.refresh_token,
        token_type_hint: "refresh_token",
      });
    },
    verifyNotification: async (credentials, jwt) => {
      const [headerPart, payloadPart, signaturePart] = jwt.split(".");
      if (headerPart === undefined || payloadPart === undefined || signaturePart === undefined)
        throw new Error("Malformed notification");
      const header = z
        .object({ alg: z.literal("RS256"), kid: z.string() })
        .parse(JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8")));
      const keys = await fetchImpl(`${APPLE_ISSUER}/auth/keys`);
      const jwk = JwksSchema.parse(await keys.json()).keys.find((key) => key.kid === header.kid);
      if (jwk === undefined) throw new Error("Unknown Apple signing key");
      const valid = verify(
        "RSA-SHA256",
        Buffer.from(`${headerPart}.${payloadPart}`),
        createPublicKey({ key: jwk as JsonWebKey, format: "jwk" }),
        Buffer.from(signaturePart, "base64url"),
      );
      if (!valid) throw new Error("Invalid notification signature");
      const claims = z
        .object({
          iss: z.literal(APPLE_ISSUER),
          aud: z.string(),
          exp: z.number(),
          events: z.string(),
        })
        .parse(JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")));
      if (claims.aud !== credentials.servicesId) throw new Error("Notification for another app");
      if (claims.exp < now()) throw new Error("Expired notification");
      return AppleEventSchema.parse(JSON.parse(claims.events));
    },
  };
}

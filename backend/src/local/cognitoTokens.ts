import { createPublicKey, verify, type JsonWebKey } from "node:crypto";
import { z } from "zod";

/** The Test stage's Cognito settings the local server verifies tokens against (authn-authz.md section 11). */
export interface CognitoTestSettings {
  region: string;
  userPoolId: string;
  userPoolClientId: string;
}

/** A verified signed-in caller: their `sub` and the groups their ID token carries. */
export interface VerifiedAccount {
  sub: string;
  groups: string[];
}

export type FetchJson = (url: string) => Promise<unknown>;

const JwksSchema = z.object({ keys: z.array(z.looseObject({ kid: z.string() })) });
const ClaimsSchema = z.object({
  sub: z.string().min(1),
  iss: z.string(),
  aud: z.string(),
  token_use: z.literal("id"),
  exp: z.number(),
  "cognito:groups": z.array(z.string()).optional(),
});

/**
 * Verifies Cognito ID tokens from the Test User Pool: RS256 signature
 * against the pool's published keys (fetched once), issuer, audience (the web
 * client), token use and expiry. Returns null for any token that fails.
 */
export function createCognitoTokenVerifier(
  settings: CognitoTestSettings,
  fetchJson: FetchJson = async (url) => (await fetch(url)).json(),
  now: () => number = () => Math.floor(Date.now() / 1000),
): (token: string) => Promise<VerifiedAccount | null> {
  const issuer = `https://cognito-idp.${settings.region}.amazonaws.com/${settings.userPoolId}`;
  let keys: Promise<z.infer<typeof JwksSchema>["keys"]> | undefined;
  const signingKeys = () => {
    keys ??= fetchJson(`${issuer}/.well-known/jwks.json`).then(
      (body) => JwksSchema.parse(body).keys,
    );
    return keys;
  };
  return async (token) => {
    try {
      const [headerPart, payloadPart, signaturePart] = token.split(".");
      if (headerPart === undefined || payloadPart === undefined || signaturePart === undefined)
        return null;
      const header = z
        .object({ alg: z.literal("RS256"), kid: z.string() })
        .parse(JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8")));
      const jwk = (await signingKeys()).find((key) => key.kid === header.kid);
      if (jwk === undefined) return null;
      const valid = verify(
        "RSA-SHA256",
        Buffer.from(`${headerPart}.${payloadPart}`),
        createPublicKey({ key: jwk as JsonWebKey, format: "jwk" }),
        Buffer.from(signaturePart, "base64url"),
      );
      if (!valid) return null;
      const claims = ClaimsSchema.parse(
        JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")),
      );
      if (claims.iss !== issuer || claims.aud !== settings.userPoolClientId || claims.exp < now())
        return null;
      return { sub: claims.sub, groups: claims["cognito:groups"] ?? [] };
    } catch {
      return null;
    }
  };
}

import { randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

export const DEV_CALLER_HEADER = "x-allplay-dev-caller";
export const DEFAULT_DEV_CALLER = "local-guest";

export type DevTier = "guest" | "player" | "admin";

export interface DevCaller {
  tier: DevTier;
  id: string;
}

/**
 * The development caller from the header (authn-authz.md section 11):
 * `guest:<id>`, `player:<id>` or `admin:<id>`, where a bare `<id>` is a guest.
 * Anything malformed falls back to the default guest.
 */
export function devCaller(headers: IncomingHttpHeaders): DevCaller {
  const value = headers[DEV_CALLER_HEADER];
  const match =
    typeof value === "string"
      ? /^(?:(guest|player|admin):)?([A-Za-z0-9_-]{1,64})$/.exec(value)
      : null;
  if (match === null) return { tier: "guest", id: DEFAULT_DEV_CALLER };
  return { tier: (match[1] ?? "guest") as DevTier, id: match[2] as string };
}

const ROLES: Record<DevTier, string> = {
  guest: "AllPlay-GuestRole-Local",
  player: "AllPlay-PlayerRole-Local",
  admin: "AllPlay-AdminRole-Local",
};

/**
 * The Identity Pool fields API Gateway would put on the request for this
 * caller, so resolveCaller and the route tiers run unchanged locally.
 */
export function devIdentity(caller: DevCaller): {
  cognitoIdentity: { identityId: string; identityPoolId: string; amr: string[] };
  userArn: string;
} {
  const signedIn = caller.tier !== "guest";
  return {
    cognitoIdentity: {
      identityId: signedIn ? `local:${caller.id}` : caller.id,
      identityPoolId: "local",
      amr: signedIn
        ? ["authenticated", "cognito-idp.local", `cognito-idp.local:CognitoSignIn:${caller.id}`]
        : ["unauthenticated"],
    },
    userArn: `arn:aws:sts::000000000000:assumed-role/${ROLES[caller.tier]}/CognitoIdentityCredentials`,
  };
}

/** The playerId resolveCaller derives for a development caller. */
export function devPlayerId(caller: DevCaller): string {
  return caller.tier === "guest" ? `GUEST#${caller.id}` : `ACCT#${caller.id}`;
}

export interface LocalRequest {
  method: string;
  path: string;
  /** The caller, when the server resolved it itself (the `cognito-test` setting); otherwise the development header. */
  caller?: DevCaller;
  /** The matched route's path template, for example `/v1/sessions/{sessionId}`. */
  template?: string;
  pathParameters?: Record<string, string>;
  query: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

/**
 * Builds the API Gateway HTTP API (payload 2.0) event a Lambda would receive.
 * The development caller goes into the IAM identity field that resolveCaller
 * reads (local-development.md section 3).
 */
export function toHttpApiEvent(
  request: LocalRequest,
  newId: () => string = randomUUID,
): Record<string, unknown> {
  const headers = Object.fromEntries(
    Object.entries(request.headers).map(([name, value]) => [
      name,
      Array.isArray(value) ? value.join(",") : (value ?? ""),
    ]),
  );
  const query = Object.fromEntries(new URLSearchParams(request.query));
  return {
    version: "2.0",
    routeKey: `${request.method} ${request.template ?? request.path}`,
    rawPath: request.path,
    rawQueryString: request.query,
    headers,
    ...(request.pathParameters === undefined ? {} : { pathParameters: request.pathParameters }),
    ...(Object.keys(query).length === 0 ? {} : { queryStringParameters: query }),
    ...(request.body.length === 0
      ? {}
      : { body: request.body.toString("base64"), isBase64Encoded: true }),
    requestContext: {
      requestId: newId(),
      http: { method: request.method, path: request.path, sourceIp: "127.0.0.1" },
      authorizer: { iam: devIdentity(request.caller ?? devCaller(request.headers)) },
    },
  };
}

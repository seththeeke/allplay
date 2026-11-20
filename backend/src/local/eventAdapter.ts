import { randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

export const DEV_CALLER_HEADER = "x-allplay-dev-caller";
export const DEFAULT_DEV_CALLER = "local-guest";

/** The development caller from the header, or the default guest; anything unsafe falls back to the default. */
export function devCaller(headers: IncomingHttpHeaders): string {
  const value = headers[DEV_CALLER_HEADER];
  return typeof value === "string" && /^[A-Za-z0-9:_-]{1,64}$/.test(value)
    ? value
    : DEFAULT_DEV_CALLER;
}

export interface LocalRequest {
  method: string;
  path: string;
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
      authorizer: { iam: { cognitoIdentity: { identityId: devCaller(request.headers) } } },
    },
  };
}

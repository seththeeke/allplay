/** Builds an API Gateway HTTP API (payload 2.0) event for controller tests. */
export function apiEvent(
  routeKey: string,
  options: {
    path?: string;
    body?: unknown;
    identity?: string | null;
    pathParameters?: Record<string, string>;
    query?: Record<string, string>;
  } = {},
): Record<string, unknown> {
  const [method, template] = routeKey.split(" ") as [string, string];
  const path = options.path ?? template;
  return {
    routeKey,
    rawPath: path,
    ...(options.body === undefined
      ? {}
      : {
          body: typeof options.body === "string" ? options.body : JSON.stringify(options.body),
        }),
    ...(options.pathParameters === undefined ? {} : { pathParameters: options.pathParameters }),
    ...(options.query === undefined ? {} : { queryStringParameters: options.query }),
    requestContext: {
      requestId: "r1",
      http: { method, path },
      ...(options.identity === null
        ? {}
        : { authorizer: { iam: { cognitoIdentity: { identityId: options.identity ?? "p1" } } } }),
    },
  };
}

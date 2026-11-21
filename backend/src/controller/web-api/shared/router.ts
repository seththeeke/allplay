import type { Logger } from "../../../logger";
import { GameSessionError } from "../../../service/gameSession/errors";
import { HttpEventSchema, type HttpEvent } from "./httpEvent";
import type { Tier } from "../../../models/api";
import { resolveCaller, tierAtLeast, type Caller } from "./resolveCaller";
import { errorResponse, jsonResponse, type HttpResult } from "./response";

/** What a controller receives: the parsed event and the caller from resolveCaller. */
export interface RouteRequest {
  event: HttpEvent;
  caller: Caller;
  param: (name: string) => string;
  query: (name: string) => string | undefined;
}

/** A controller returns a status and body; a thrown GameSessionError becomes its error response. */
export type Controller = (request: RouteRequest) => Promise<[number, unknown]>;

/**
 * Builds a bundle's Lambda handler from controllers keyed by route key
 * (`<METHOD> <path template>`). The event is zod-parsed and the caller
 * resolved before any controller runs.
 */
export function createRouter(
  controllers: Readonly<Record<string, Controller>>,
  logger: Logger,
  routes: readonly { method: string; path: string; minimumTier?: Tier }[] = [],
  identityPoolId: string | undefined = process.env["IDENTITY_POOL_ID"],
): (event: unknown) => Promise<HttpResult> {
  const minimum = new Map(
    routes.map((route) => [`${route.method} ${route.path}`, route.minimumTier ?? "GUEST"]),
  );
  return async (raw) => {
    const parsed = HttpEventSchema.safeParse(raw);
    if (!parsed.success) return errorResponse(400, "VALIDATION_ERROR", "Malformed request.");
    const event = parsed.data;
    const controller = event.routeKey === undefined ? undefined : controllers[event.routeKey];
    if (controller === undefined) return errorResponse(404, "NOT_FOUND", "No such route.");
    const caller = resolveCaller(event, identityPoolId);
    if (caller === null)
      return errorResponse(401, "UNAUTHORIZED", "Sign in or continue as a guest first.");
    /* IAM already allowed the route for the caller's role; the route's tier is checked again here (section 1). */
    if (!tierAtLeast(caller.tier, minimum.get(event.routeKey as string) ?? "GUEST"))
      return errorResponse(
        403,
        "FORBIDDEN",
        caller.tier === "GUEST" ? "Sign in to do that." : "You do not have access to that.",
      );
    try {
      const [status, body] = await controller({
        event,
        caller,
        param: (name) => event.pathParameters?.[name] ?? "",
        query: (name) => event.queryStringParameters?.[name],
      });
      return jsonResponse(status, body);
    } catch (error) {
      if (error instanceof GameSessionError) {
        return jsonResponse(error.status, {
          code: error.code,
          message: error.message,
          ...(error.current === undefined ? {} : { current: error.current }),
        });
      }
      logger.error("Request failed", {
        requestId: event.requestContext.requestId,
        routeKey: event.routeKey,
        error: String(error),
      });
      return errorResponse(500, "INTERNAL_ERROR", "Something went wrong.");
    }
  };
}

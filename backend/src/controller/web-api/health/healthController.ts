import type { Logger } from "../../../logger";
import { HealthResponseSchema } from "../../../models/api";
import type { HealthService } from "../../../service/healthService";
import { HttpEventSchema } from "../shared/httpEvent";
import { errorResponse, jsonResponse, type HttpResult } from "../shared/response";
import { healthRoutes } from "./healthRoutes";

export interface HealthControllerDeps {
  health: HealthService;
  logger: Logger;
}

const [route] = healthRoutes;

/** Lambda handler for the health bundle: parses the event, then asks the health service. */
export function createHealthHandler(
  deps: HealthControllerDeps,
): (event: unknown) => Promise<HttpResult> {
  return (event) => {
    const parsed = HttpEventSchema.safeParse(event);
    if (!parsed.success) {
      deps.logger.warn("Rejected malformed event", { issues: parsed.error.issues.length });
      return Promise.resolve(errorResponse(400, "VALIDATION_ERROR", "Malformed request."));
    }
    const { method, path } = parsed.data.requestContext.http;
    const log = deps.logger.child({ requestId: parsed.data.requestContext.requestId });
    if (method !== route.method || path !== route.path) {
      log.info("No such route", { method, path });
      return Promise.resolve(errorResponse(404, "NOT_FOUND", "No such route."));
    }
    const body = HealthResponseSchema.parse(deps.health.check());
    log.info("Health check", { stage: body.stage });
    return Promise.resolve(jsonResponse(200, body));
  };
}

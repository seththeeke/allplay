import type { Logger } from "../../../logger";
import { DecisionRequestSchema, DecisionResponseSchema } from "../../../models/api";
import type { DecisionService } from "../../../service/decision/decisionService";
import { HttpEventSchema, jsonBody } from "../shared/httpEvent";
import { resolveCaller } from "../shared/resolveCaller";
import { errorResponse, jsonResponse, type HttpResult } from "../shared/response";

export interface DecisionsControllerDeps {
  decisions: DecisionService;
  logger: Logger;
}

/** Handler for the decisions bundle: parses the event and body, resolves the caller, then asks the decision service. */
export function createDecisionsHandler(
  deps: DecisionsControllerDeps,
): (event: unknown) => Promise<HttpResult> {
  return async (event) => {
    const parsed = HttpEventSchema.safeParse(event);
    if (!parsed.success) return errorResponse(400, "VALIDATION_ERROR", "Malformed request.");
    const { method, path } = parsed.data.requestContext.http;
    if (method !== "POST" || path !== "/v1/decisions")
      return errorResponse(404, "NOT_FOUND", "No such route.");
    const caller = resolveCaller(parsed.data);
    if (caller === null)
      return errorResponse(401, "UNAUTHORIZED", "Sign in or continue as a guest first.");
    const request = DecisionRequestSchema.safeParse(jsonBody(parsed.data));
    if (!request.success)
      return errorResponse(400, "VALIDATION_ERROR", "The command could not be read.");
    const response = DecisionResponseSchema.parse(
      await deps.decisions.decide(caller.playerId, request.data),
    );
    deps.logger.info("Decision recorded", {
      requestId: parsed.data.requestContext.requestId,
      decisionId: response.decisionId,
      outcome: response.outcome,
      transcriptSource: request.data.transcriptSource,
    });
    return jsonResponse(200, response);
  };
}

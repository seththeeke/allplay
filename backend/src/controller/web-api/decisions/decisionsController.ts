import type { Logger } from "../../../logger";
import {
  DecisionRequestSchema,
  DecisionResponseSchema,
  ResolutionRequestSchema,
  ResolutionResponseSchema,
} from "../../../models/api";
import type { DecisionService } from "../../../service/decision/decisionService";
import { invalidRequest } from "../../../service/gameSession/errors";
import { jsonBody } from "../shared/httpEvent";
import type { HttpResult } from "../shared/response";
import { createRouter } from "../shared/router";

export interface DecisionsControllerDeps {
  decisions: DecisionService;
  logger: Logger;
}

/** Handler for the decisions bundle (action-decision.md section 4): parse, resolve the caller, then decide or resolve. */
export function createDecisionsHandler(
  deps: DecisionsControllerDeps,
): (event: unknown) => Promise<HttpResult> {
  return createRouter(
    {
      "POST /v1/decisions": async ({ event, caller }) => {
        const request = DecisionRequestSchema.safeParse(jsonBody(event));
        if (!request.success) throw invalidRequest("The command could not be read.");
        const response = DecisionResponseSchema.parse(
          await deps.decisions.decide(caller.playerId, request.data),
        );
        deps.logger.info("Decision recorded", {
          requestId: event.requestContext.requestId,
          decisionId: response.decisionId,
          outcome: response.outcome,
          transcriptSource: request.data.transcriptSource,
        });
        return [200, response];
      },
      "POST /v1/decisions/{decisionId}/resolution": async ({ event, caller, param }) => {
        const request = ResolutionRequestSchema.safeParse(jsonBody(event));
        if (!request.success) throw invalidRequest("The resolution could not be read.");
        const decisionId = param("decisionId");
        const response = ResolutionResponseSchema.parse(
          await deps.decisions.resolve(caller.playerId, decisionId, request.data),
        );
        deps.logger.info("Decision resolved", {
          requestId: event.requestContext.requestId,
          decisionId,
          resolution: request.data.resolution,
        });
        return [200, response];
      },
    },
    deps.logger,
  );
}

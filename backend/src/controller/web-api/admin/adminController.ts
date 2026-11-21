import { z } from "zod";
import type { Logger } from "../../../logger";
import {
  DeploymentsResponseSchema,
  DuplicateAccountsResponseSchema,
  MergeAccountsRequestSchema,
  MergeResponseSchema,
  StartDeploymentResponseSchema,
} from "../../../models/api";
import type { AccountAdminService } from "../../../service/admin/accountAdminService";
import type { DeploymentService } from "../../../service/admin/deploymentService";
import { invalidRequest } from "../../../service/gameSession/errors";
import { jsonBody } from "../shared/httpEvent";
import { jsonResponse, type HttpResult } from "../shared/response";
import { createRouter } from "../shared/router";
import { adminRoutes } from "./adminRoutes";

export interface AdminControllerDeps {
  deployments: DeploymentService;
  accounts: AccountAdminService;
  logger: Logger;
}

/**
 * The operator's direct invocation of the admin Lambda by
 * `scripts/merge-accounts.sh`. Only callers allowed `lambda:InvokeFunction`
 * reach it; API Gateway events never have this shape.
 */
const OperatorMergeSchema = MergeAccountsRequestSchema.extend({
  operatorTask: z.literal("MERGE_ACCOUNTS"),
});

/** Handler for the admin bundle (authn-authz.md section 5); every route requires the ADMIN tier. */
export function createAdminHandler(
  deps: AdminControllerDeps,
): (event: unknown) => Promise<HttpResult> {
  const router = createRouter(
    {
      "GET /v1/admin/deployments": async () => [
        200,
        DeploymentsResponseSchema.parse(await deps.deployments.recent()),
      ],
      "POST /v1/admin/deployments": async ({ caller }) => {
        const executionId = await deps.deployments.start();
        deps.logger.info("Deployment started", { executionId, playerId: caller.playerId });
        return [202, StartDeploymentResponseSchema.parse({ executionId })];
      },
      "GET /v1/admin/players/duplicates": async () => [
        200,
        DuplicateAccountsResponseSchema.parse(await deps.accounts.duplicates()),
      ],
      "POST /v1/admin/players/merge": async ({ caller, event }) => {
        const request = MergeAccountsRequestSchema.safeParse(jsonBody(event));
        if (!request.success) throw invalidRequest("Send { primaryPlayerId, duplicatePlayerId }.");
        const merged = await deps.accounts.merge(
          request.data.primaryPlayerId,
          request.data.duplicatePlayerId,
        );
        deps.logger.info("Accounts merged by an admin", { ...merged, admin: caller.playerId });
        return [200, MergeResponseSchema.parse(merged)];
      },
    },
    deps.logger,
    adminRoutes,
  );
  return async (event) => {
    const operator = OperatorMergeSchema.safeParse(event);
    if (!operator.success) return router(event);
    const merged = await deps.accounts.merge(
      operator.data.primaryPlayerId,
      operator.data.duplicatePlayerId,
    );
    deps.logger.info("Accounts merged by the operator", merged);
    return jsonResponse(200, MergeResponseSchema.parse(merged));
  };
}

import type { Logger } from "../../../logger";
import { DeploymentsResponseSchema, StartDeploymentResponseSchema } from "../../../models/api";
import type { DeploymentService } from "../../../service/admin/deploymentService";
import type { HttpResult } from "../shared/response";
import { createRouter } from "../shared/router";
import { adminRoutes } from "./adminRoutes";

export interface AdminControllerDeps {
  deployments: DeploymentService;
  logger: Logger;
}

/** Handler for the admin bundle (authn-authz.md section 5); every route requires the ADMIN tier. */
export function createAdminHandler(
  deps: AdminControllerDeps,
): (event: unknown) => Promise<HttpResult> {
  return createRouter(
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
    },
    deps.logger,
    adminRoutes,
  );
}

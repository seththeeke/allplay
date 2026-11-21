import { logger } from "../../../logger";
import { createDeployedDeploymentService } from "../../../service/admin/deploymentService";
import { createAdminHandler } from "./adminController";

/** Entry point of the `AllPlay-AdminApi-<Stage>` Lambda. */
export const handler = createAdminHandler({
  deployments: createDeployedDeploymentService(),
  logger: logger.child({ bundle: "admin" }),
});

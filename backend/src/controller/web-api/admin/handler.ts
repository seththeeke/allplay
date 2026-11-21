import { logger } from "../../../logger";
import { createDeployedAccountAdminService } from "../../../service/admin/accountAdminService";
import { createDeployedDeploymentService } from "../../../service/admin/deploymentService";
import { createAdminHandler } from "./adminController";

/** Entry point of the `AllPlay-AdminApi-<Stage>` Lambda. */
export const handler = createAdminHandler({
  deployments: createDeployedDeploymentService(),
  accounts: createDeployedAccountAdminService(),
  logger: logger.child({ bundle: "admin" }),
});

import { logger } from "../../../logger";
import { createDeployedAccountAdminService } from "../../../service/admin/accountAdminService";
import { createDeployedDeploymentService } from "../../../service/admin/deploymentService";
import { createDeployedMetricsAdminService } from "../../../service/admin/metricsAdminService";
import { createDeployedAndonService } from "../../../service/andon/andonService";
import { createDeployedInvitationService } from "../../../service/admin/invitationService";
import { createAdminHandler } from "./adminController";

/** Entry point of the `AllPlay-AdminApi-<Stage>` Lambda. */
export const handler = createAdminHandler({
  deployments: createDeployedDeploymentService(),
  accounts: createDeployedAccountAdminService(),
  metrics: createDeployedMetricsAdminService(),
  andon: createDeployedAndonService(),
  invitations: createDeployedInvitationService(),
  logger: logger.child({ bundle: "admin" }),
});

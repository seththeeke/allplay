import { logger } from "../../../logger";
import { createDeployedDecisionService } from "../../../service/decision/deployedDecider";
import { createDecisionsHandler } from "./decisionsController";

/** Entry point of the `AllPlay-DecisionApi-<Stage>` Lambda. */
const decisionsLogger = logger.child({ bundle: "decisions" });
export const handler = createDecisionsHandler({
  decisions: createDeployedDecisionService(decisionsLogger),
  logger: decisionsLogger,
});

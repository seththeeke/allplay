import { logger } from "../../../logger";
import { createDeployedDecisionService } from "../../../service/decision/deployedDecider";
import { createDeployedAndonGate } from "../../../service/andon/andonService";
import { createDeployedMetricsRecorder } from "../../../service/metrics/metricsRecorder";
import { createDecisionsHandler } from "./decisionsController";

/** Entry point of the `AllPlay-DecisionApi-<Stage>` Lambda. */
const decisionsLogger = logger.child({ bundle: "decisions" });
const andon = createDeployedAndonGate(decisionsLogger);
const metrics = createDeployedMetricsRecorder(decisionsLogger);
export const handler = createDecisionsHandler({
  decisions: createDeployedDecisionService(decisionsLogger),
  logger: decisionsLogger,
  ...(andon === undefined ? {} : { andon }),
  ...(metrics === undefined ? {} : { metrics }),
});

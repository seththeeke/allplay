import { logger } from "../../logger";
import { createDeployedRollupJob } from "../../service/metrics/rollupJob";

/** Entry point of the `AllPlay-MetricsRollup-<Stage>` Lambda, run daily at 00:15 UTC by the scheduler. */
const job = createDeployedRollupJob();
export const handler = async (): Promise<void> => {
  const { period, totals } = await job.run();
  logger.info("Metrics rolled up", { period, ...totals });
};

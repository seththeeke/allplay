import { logger } from "../../../logger";
import { createHealthService } from "../../../service/healthService";
import { createHealthHandler } from "./healthController";

/** Entry point of the `AllPlay-HealthApi-<Stage>` Lambda; STAGE is set by the AllPlayFunction construct. */
export const handler = createHealthHandler({
  health: createHealthService(process.env["STAGE"] ?? "UNKNOWN"),
  logger: logger.child({ bundle: "health" }),
});

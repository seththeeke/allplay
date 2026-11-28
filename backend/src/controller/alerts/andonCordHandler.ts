import { logger } from "../../logger";
import { andonStagesFrom } from "../../service/andon/andonService";
import { createAndonCordHandler } from "./andonCord";

/** Entry point of the `AllPlay-AndonCord` Lambda, subscribed to the `AllPlay-Andon` topic. */
export const handler = createAndonCordHandler(
  andonStagesFrom(process.env),
  logger.child({ bundle: "andon" }),
);

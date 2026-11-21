import { logger } from "../../logger";
import { createCustomMessageHandler } from "./customMessage";

/** Entry point of the `AllPlay-CognitoCustomMessage-<Stage>` Lambda. */
export const handler = createCustomMessageHandler(logger.child({ trigger: "custom-message" }));

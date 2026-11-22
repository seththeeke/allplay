import { createBundledRulesRepository } from "../../../game-catalog";
import { logger } from "../../../logger";
import { createDeployedGameSessionService } from "../../../service/gameSession/gameSessionService";
import { createGameHandler } from "./gameController";

/** Entry point of the `AllPlay-GameApi-<Stage>` Lambda: the bundled catalog over the game tables. */
const repository = createBundledRulesRepository();
export const handler = createGameHandler({
  catalog: repository,
  sessions: createDeployedGameSessionService(repository),
  logger: logger.child({ bundle: "game" }),
});

import { createBundledRulesRepository } from "../../../game-catalog";
import { logger } from "../../../logger";
import { createDeployedGameSessionService } from "../../../service/gameSession/gameSessionService";
import { createDeployedAndonGate } from "../../../service/andon/andonService";
import { createGameHandler } from "./gameController";

/** Entry point of the `AllPlay-GameApi-<Stage>` Lambda: the bundled catalog over the game tables. */
const repository = createBundledRulesRepository();
const gameLogger = logger.child({ bundle: "game" });
const andon = createDeployedAndonGate(gameLogger);
export const handler = createGameHandler({
  catalog: repository,
  sessions: createDeployedGameSessionService(repository),
  logger: gameLogger,
  ...(andon === undefined ? {} : { andon }),
});

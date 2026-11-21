import { logger } from "../../../logger";
import { createDeployedPlayerService } from "../../../service/player/playerService";
import { createPlayersHandler } from "./playersController";

/** Entry point of the `AllPlay-PlayerApi-<Stage>` Lambda. */
export const handler = createPlayersHandler({
  players: createDeployedPlayerService(),
  logger: logger.child({ bundle: "players" }),
});

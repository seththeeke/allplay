import { logger } from "../../../logger";
import { createDeployedAppleService } from "../../../service/player/appleService";
import { createIdentityService } from "../../../service/player/identityService";
import { createDeployedMergeService } from "../../../service/player/mergeService";
import {
  createDeployedPlayerService,
  createDeployedPlayerDao,
} from "../../../service/player/playerService";
import { createPlayersHandler } from "./playersController";

/** Entry point of the `AllPlay-PlayerApi-<Stage>` Lambda. */
const players = createDeployedPlayerService();
export const handler = createPlayersHandler({
  players,
  apple: createDeployedAppleService({
    identities: createIdentityService(),
    players: createDeployedPlayerDao(),
    accounts: players,
    logger: logger.child({ bundle: "players", provider: "apple" }),
  }),
  merge: createDeployedMergeService(),
  logger: logger.child({ bundle: "players" }),
});

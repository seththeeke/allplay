import { logger } from "../../../logger";
import { createDeployedAppleService } from "../../../service/player/appleService";
import { createIdentityService } from "../../../service/player/identityService";
import { createDeployedMergeService } from "../../../service/player/mergeService";
import {
  createDeployedPlayerService,
  createDeployedPlayerDao,
} from "../../../service/player/playerService";
import { createDeployedAndonGate } from "../../../service/andon/andonService";
import { createPlayersHandler } from "./playersController";

/** Entry point of the `AllPlay-PlayerApi-<Stage>` Lambda. */
const players = createDeployedPlayerService();
const playersLogger = logger.child({ bundle: "players" });
const andon = createDeployedAndonGate(playersLogger);
export const handler = createPlayersHandler({
  players,
  apple: createDeployedAppleService({
    identities: createIdentityService(),
    players: createDeployedPlayerDao(),
    accounts: players,
    logger: logger.child({ bundle: "players", provider: "apple" }),
  }),
  merge: createDeployedMergeService(),
  logger: playersLogger,
  ...(andon === undefined ? {} : { andon }),
});

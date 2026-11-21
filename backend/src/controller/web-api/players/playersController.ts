import type { Logger } from "../../../logger";
import {
  PatchAppPreferencesSchema,
  PatchGamePreferencesSchema,
  PlayerMeSchema,
  PreferencesResponseSchema,
} from "../../../models/api";
import { invalidRequest } from "../../../service/gameSession/errors";
import type { PlayerService } from "../../../service/player/playerService";
import { jsonBody } from "../shared/httpEvent";
import type { HttpResult } from "../shared/response";
import { createRouter } from "../shared/router";
import { playersRoutes } from "./playersRoutes";

export interface PlayersControllerDeps {
  players: PlayerService;
  logger: Logger;
}

/** A preference scope from the path: `APP` or `GAME#<gameId>` (data-model.md section 5). */
const SCOPE = /^(APP|GAME#([a-z0-9-]+))$/;

/**
 * Handler for the player bundle (authn-authz.md section 5): the caller's own
 * player and preferences. Every request first records the caller's activity
 * (the guest upsert of section 4).
 */
export function createPlayersHandler(
  deps: PlayersControllerDeps,
): (event: unknown) => Promise<HttpResult> {
  return createRouter(
    {
      "GET /v1/players/me": async ({ caller }) => [
        200,
        PlayerMeSchema.parse(await deps.players.me(caller)),
      ],
      "DELETE /v1/players/me": async ({ caller }) => {
        await deps.players.deleteAccount(caller);
        deps.logger.info("Account deleted", { playerId: caller.playerId });
        return [200, { deleted: true }];
      },
      "GET /v1/players/me/preferences": async ({ caller }) => [
        200,
        PreferencesResponseSchema.parse(await deps.players.preferences(caller.playerId)),
      ],
      "PATCH /v1/players/me/preferences/{scope}": async ({ caller, event, param }) => {
        const scope = SCOPE.exec(param("scope"));
        if (scope === null) throw invalidRequest("The scope is APP or GAME#<gameId>.");
        const gameId = scope[2];
        if (gameId === undefined) {
          const patch = PatchAppPreferencesSchema.strict().safeParse(jsonBody(event));
          if (!patch.success) throw invalidRequest("The preferences could not be read.");
          return [200, await deps.players.patchApp(caller, patch.data)];
        }
        const patch = PatchGamePreferencesSchema.strict().safeParse(jsonBody(event));
        if (!patch.success) throw invalidRequest("The preferences could not be read.");
        return [200, await deps.players.patchGame(caller, gameId, patch.data)];
      },
    },
    deps.logger,
    playersRoutes,
    undefined,
    (caller) => deps.players.recordActivity(caller),
  );
}

import type { Logger } from "../../../logger";
import {
  MergeRequestSchema,
  MergeResponseSchema,
  MergeTokenResponseSchema,
  PatchAppPreferencesSchema,
  PatchGamePreferencesSchema,
  PlayerMeSchema,
  PreferencesResponseSchema,
} from "../../../models/api";
import { invalidRequest } from "../../../service/gameSession/errors";
import type { AppleService } from "../../../service/player/appleService";
import type { MergeService } from "../../../service/player/mergeService";
import type { PlayerService } from "../../../service/player/playerService";
import { z } from "zod";
import { HttpEventSchema, jsonBody } from "../shared/httpEvent";
import { errorResponse, jsonResponse } from "../shared/response";
import type { HttpResult } from "../shared/response";
import { createRouter } from "../shared/router";
import { appleNotificationsRoute, playersRoutes } from "./playersRoutes";

export interface PlayersControllerDeps {
  players: PlayerService;
  /** Sign in with Apple revocation and notifications; absent where Apple is not used (the local server). */
  apple?: AppleService;
  merge: MergeService;
  logger: Logger;
}

const DeleteBodySchema = z.object({ appleAuthorizationCode: z.string().min(1).optional() });
const NotificationSchema = z.object({ payload: z.string().min(1) });

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
  const router = createRouter(
    {
      "GET /v1/players/me": async ({ caller }) => [
        200,
        PlayerMeSchema.parse(await deps.players.me(caller)),
      ],
      "DELETE /v1/players/me": async ({ caller, event }) => {
        const body = DeleteBodySchema.safeParse(jsonBody(event) ?? {});
        if (!body.success) throw invalidRequest("The deletion request could not be read.");
        /* Apple tokens are revoked first when the client sent a fresh code; deletion happens either way. */
        const revoked =
          (await deps.apple?.revokeForDeletion(body.data.appleAuthorizationCode)) ?? false;
        await deps.players.deleteAccount(caller);
        deps.logger.info("Apple tokens revoked", { revoked });
        deps.logger.info("Account deleted", { playerId: caller.playerId });
        return [200, { deleted: true }];
      },
      "POST /v1/players/me/sign-out": async ({ caller }) => {
        await deps.players.signOut(caller);
        deps.logger.info("Signed out everywhere", { playerId: caller.playerId });
        return [200, { signedOut: true }];
      },
      "POST /v1/players/me/merge-tokens": async ({ caller }) => [
        201,
        MergeTokenResponseSchema.parse(await deps.merge.issue(caller)),
      ],
      "POST /v1/players/me/merge": async ({ caller, event }) => {
        const request = MergeRequestSchema.safeParse(jsonBody(event));
        if (!request.success) throw invalidRequest("Send { token } and optionally keep: SOURCE.");
        const merged = MergeResponseSchema.parse(
          await deps.merge.redeem(caller, request.data.token, request.data.keep),
        );
        deps.logger.info("Players merged", merged);
        return [200, merged];
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
  const appleKey = `${appleNotificationsRoute.method} ${appleNotificationsRoute.path}`;
  return async (raw) => {
    const parsed = HttpEventSchema.safeParse(raw);
    if (!parsed.success || parsed.data.routeKey !== appleKey) return router(raw);
    const notification = NotificationSchema.safeParse(jsonBody(parsed.data));
    if (!notification.success || deps.apple === undefined)
      return errorResponse(400, "VALIDATION_ERROR", "Send { payload }.");
    try {
      const result = await deps.apple.handleNotification(notification.data.payload);
      deps.logger.info("Apple notification handled", { result });
      return jsonResponse(200, { result });
    } catch (error) {
      deps.logger.warn("Apple notification refused", { error });
      return errorResponse(400, "VALIDATION_ERROR", "The notification could not be verified.");
    }
  };
}

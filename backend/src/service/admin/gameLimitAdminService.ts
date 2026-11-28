import { createDynamoPlayerDao } from "../../dao/player/dynamoPlayerDao";
import type { PlayerDao } from "../../dao/player/playerDao";
import type { AdminPlayer, GameLimit } from "../../models/api";
import { emailKeyOf, type Player } from "../../models/player";
import { notFound } from "../gameSession/errors";
import {
  createGameAllowanceService,
  parseGameLimit,
  type GameAllowanceService,
} from "../player/gameAllowance";

/** Admins find accounts and set their game limits (productionalization.md section 5, item 7). */
export interface GameLimitAdminService {
  /** Active accounts with this email, oldest first. */
  find(email: string): Promise<AdminPlayer[]>;
  /** Sets the player's limit, or clears it back to the stage default with null. */
  setLimit(playerId: string, gameLimit: GameLimit | null): Promise<AdminPlayer>;
}

export function createGameLimitAdminService(
  players: Pick<PlayerDao, "get" | "listByEmail" | "update">,
  allowance: Pick<GameAllowanceService, "allowance">,
  now: () => Date = () => new Date(),
): GameLimitAdminService {
  const shown = (player: Player): AdminPlayer => ({
    playerId: player.playerId,
    email: player.email ?? null,
    gameLimit: player.gameLimit ?? null,
    gameAllowance: allowance.allowance(player),
  });
  return {
    find: async (email) => {
      const found: AdminPlayer[] = [];
      for (const match of await players.listByEmail(emailKeyOf(email))) {
        if (match.status !== "ACTIVE") continue;
        const player = await players.get(match.playerId);
        if (player !== null) found.push(shown(player));
      }
      return found;
    },
    setLimit: async (playerId, gameLimit) => {
      if ((await players.get(playerId)) === null) throw notFound("Player");
      const at = now().toISOString();
      const updated =
        gameLimit === null
          ? await players.update(playerId, {}, at, ["gameLimit"])
          : await players.update(playerId, { gameLimit }, at);
      return shown(updated);
    },
  };
}

/** The admin service over the stage's Players table and default limit. */
export function createDeployedGameLimitAdminService(
  env: Readonly<Record<string, string | undefined>> = process.env,
): GameLimitAdminService {
  const players = createDynamoPlayerDao(env["PLAYERS_TABLE"] ?? "");
  return createGameLimitAdminService(
    players,
    createGameAllowanceService({
      players,
      defaultLimit: parseGameLimit(env["DEFAULT_GAME_LIMIT"]),
    }),
  );
}

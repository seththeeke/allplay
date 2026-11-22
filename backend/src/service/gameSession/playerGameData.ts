import { createDynamoGameSessionDao } from "../../dao/gameSession/dynamoGameSessionDao";
import type { GameSessionDao } from "../../dao/gameSession/gameSessionDao";
import { createDynamoPlayerStatsDao } from "../../dao/playerStats/dynamoPlayerStatsDao";
import { createDynamoSeatAssignmentDao } from "../../dao/seatAssignment/dynamoSeatAssignmentDao";
import {
  StatsVersionConflictError,
  type PlayerStatsDao,
} from "../../dao/playerStats/playerStatsDao";
import type { SeatAssignmentDao } from "../../dao/seatAssignment/seatAssignmentDao";
import type { StatsEntry } from "../../models/api";
import type { GameSession } from "../../models/gameSession";
import { combineStats, toStatsEntry } from "./playerStats";
import { abandonedCopy, seatOf, seatsOf, withSessionTtl } from "./sessionRecords";

export interface PlayerGameDataDeps {
  dao: GameSessionDao;
  seats: SeatAssignmentDao;
  stats: PlayerStatsDao;
}

/** A player's sessions, seats and stats as a whole: the stats route, the merge and deletion. */
export interface PlayerGameData {
  stats(playerId: string): Promise<StatsEntry[]>;
  /** Merge step 1 (data-model.md section 10): the source's seats and sessions move to the target. */
  moveSeats(fromPlayerId: string, intoPlayerId: string, at: Date): Promise<void>;
  /** Merge step 3 (data-model.md section 10): the source's stats combine into the target's. */
  moveStats(fromPlayerId: string, intoPlayerId: string, at: Date): Promise<void>;
  /** Account deletion (data-model.md section 14): seats, stats, and sessions where the player sat alone. */
  deleteAll(playerId: string): Promise<void>;
}

/** Tries a stats write again after a concurrent change, up to three times (data-model.md section 8). */
export async function withStatsRetry(write: () => Promise<void>): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await write();
      return;
    } catch (error) {
      if (!(error instanceof StatsVersionConflictError) || attempt >= 3) throw error;
    }
  }
}

const activity = (session: GameSession): string => session.lastActionAt ?? session.startedAt;

export function createPlayerGameData(deps: PlayerGameDataDeps): PlayerGameData {
  /* Ending a session the merge displaces never counts in stats (data-model.md section 8). */
  const endUncounted = (session: GameSession, current: GameSession, at: Date) =>
    deps.dao.end({
      session,
      expectedVersion: current.version,
      seats: seatsOf(session, at),
      stats: [],
    });

  const moveOne = async (from: string, into: string, sessionId: string, at: Date) => {
    const session = await deps.dao.get(sessionId);
    if (session === null) return;
    const reseated = withSessionTtl(
      {
        ...session,
        seats: session.seats.map((seat) =>
          seat.playerId === from ? { ...seat, playerId: into } : seat,
        ),
        updatedAt: at.toISOString(),
      },
      at,
    );
    if (session.status === "IN_PROGRESS") {
      const rivalSeat = await deps.seats.currentFor(into, session.gameId);
      const rival =
        rivalSeat === null || rivalSeat.sessionId === sessionId
          ? null
          : await deps.dao.get(rivalSeat.sessionId);
      if (rival?.status === "IN_PROGRESS") {
        if (activity(rival) >= activity(session)) {
          await endUncounted(abandonedCopy(reseated, at), session, at);
          return;
        }
        await endUncounted(abandonedCopy(rival, at), rival, at);
      }
    }
    if (session.seats.some((seat) => seat.playerId === from))
      await deps.dao.update(reseated, session.version);
    await deps.seats.put(seatOf(reseated, into, at));
  };

  return {
    stats: async (playerId) => (await deps.stats.list(playerId)).map(toStatsEntry),
    moveSeats: async (from, into, at) => {
      for (const seat of await deps.seats.list(from)) {
        await moveOne(from, into, seat.sessionId, at);
        await deps.seats.delete(from, seat.sessionId);
      }
    },
    moveStats: async (from, into, at) => {
      for (const item of await deps.stats.list(from)) {
        await withStatsRetry(async () => {
          const current = await deps.stats.get(into, item.statsKey);
          await deps.stats.moveInto(
            {
              item: combineStats(current, item, into, at.toISOString()),
              expectedVersion: current?.version ?? null,
            },
            { playerId: from, statsKey: item.statsKey },
          );
        });
      }
    },
    deleteAll: async (playerId) => {
      for (const seat of await deps.seats.list(playerId)) {
        const session = await deps.dao.get(seat.sessionId);
        if (session?.seats.every((held) => held.playerId === playerId) === true)
          await deps.dao.delete(seat.sessionId);
        await deps.seats.delete(playerId, seat.sessionId);
      }
      for (const item of await deps.stats.list(playerId))
        await deps.stats.delete(playerId, item.statsKey);
    },
  };
}

/** The session, seat and stats DAOs over the tables named by GAME_SESSIONS_TABLE, SEAT_ASSIGNMENTS_TABLE and PLAYER_STATS_TABLE. */
export function createDeployedGameTables(
  env: Readonly<Record<string, string | undefined>> = process.env,
): PlayerGameDataDeps {
  const seats = env["SEAT_ASSIGNMENTS_TABLE"] ?? "";
  const stats = env["PLAYER_STATS_TABLE"] ?? "";
  return {
    dao: createDynamoGameSessionDao({ sessions: env["GAME_SESSIONS_TABLE"] ?? "", seats, stats }),
    seats: createDynamoSeatAssignmentDao(seats),
    stats: createDynamoPlayerStatsDao(stats),
  };
}

/** The player's game data over the deployed tables. */
export function createDeployedPlayerGameData(
  env: Readonly<Record<string, string | undefined>> = process.env,
): PlayerGameData {
  return createPlayerGameData(createDeployedGameTables(env));
}

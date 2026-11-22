import { GameSessionSchema, type GameSession } from "../../models/gameSession";
import type { PlayerStats } from "../../models/playerStats";
import { SeatAssignmentSchema, type SeatAssignment } from "../../models/seatAssignment";
import {
  checkStatsWrite,
  createInMemoryPlayerStatsDao,
  storeStats,
} from "../playerStats/inMemoryPlayerStatsDao";
import { PlayerStatsSchema } from "../../models/playerStats";
import type { PlayerStatsDao } from "../playerStats/playerStatsDao";
import {
  createInMemorySeatAssignmentDao,
  storeSeat,
} from "../seatAssignment/inMemorySeatAssignmentDao";
import type { SeatAssignmentDao } from "../seatAssignment/seatAssignmentDao";
import { decodeGameState, encodeGameState } from "./gameStateCodec";
import {
  SessionExistsError,
  SessionVersionConflictError,
  type GameSessionDao,
} from "./gameSessionDao";

type StoredSession = Omit<GameSession, "state"> & { state: Uint8Array };

function store(session: GameSession): StoredSession {
  const parsed = GameSessionSchema.parse(session);
  return {
    ...structuredClone({ ...parsed, state: undefined }),
    state: encodeGameState(parsed.state),
  };
}

function load(item: StoredSession): GameSession {
  return { ...structuredClone({ ...item, state: undefined }), state: decodeGameState(item.state) };
}

/** The seat and stats maps a session DAO's transactions write, shared with their own DAOs. */
export interface InMemoryGameItems {
  seats: Map<string, SeatAssignment>;
  stats: Map<string, PlayerStats>;
}

/**
 * GameSessionDao over maps (game-engine.md section 11.1). Items go through the
 * same schemas and state codec as DynamoDB, reads return copies, and each
 * transaction checks every condition and parses every item before it writes
 * any, so it is all or nothing as in DynamoDB.
 */
export function createInMemoryGameSessionDao(
  shared: InMemoryGameItems = { seats: new Map(), stats: new Map() },
): GameSessionDao {
  const items = new Map<string, StoredSession>();
  /* Each method runs inside a promise so a schema failure rejects like a DynamoDB error would. */
  const run = <T>(work: () => T): Promise<T> =>
    new Promise((resolve) => {
      resolve(work());
    });
  return {
    create: (session, seats) =>
      run(() => {
        if (items.has(session.sessionId)) throw new SessionExistsError(session.sessionId);
        const stored = store(session);
        seats.forEach((seat) => SeatAssignmentSchema.parse(seat));
        items.set(session.sessionId, stored);
        seats.forEach((seat) => {
          storeSeat(shared.seats, seat);
        });
      }),
    get: (sessionId) =>
      run(() => {
        const item = items.get(sessionId);
        return item === undefined ? null : load(item);
      }),
    update: (session, expectedVersion) =>
      run(() => {
        if (items.get(session.sessionId)?.version !== expectedVersion) {
          throw new SessionVersionConflictError(session.sessionId);
        }
        items.set(session.sessionId, store(session));
      }),
    end: (end) =>
      run(() => {
        const current = items.get(end.session.sessionId);
        if (current?.version !== end.expectedVersion || current.status !== "IN_PROGRESS")
          throw new SessionVersionConflictError(end.session.sessionId);
        end.stats.forEach((write) => {
          checkStatsWrite(shared.stats, write);
          PlayerStatsSchema.parse(write.item);
        });
        end.seats.forEach((seat) => SeatAssignmentSchema.parse(seat));
        items.set(end.session.sessionId, store(end.session));
        end.seats.forEach((seat) => {
          storeSeat(shared.seats, seat);
        });
        end.stats.forEach((write) => {
          storeStats(shared.stats, write.item);
        });
      }),
    delete: (sessionId) =>
      run(() => {
        items.delete(sessionId);
      }),
  };
}

/** The session, seat and stats DAOs over one in-memory store, as the deployed tables are. */
export function createInMemoryGameTables(): {
  dao: GameSessionDao;
  seats: SeatAssignmentDao;
  stats: PlayerStatsDao;
} {
  const shared: InMemoryGameItems = { seats: new Map(), stats: new Map() };
  return {
    dao: createInMemoryGameSessionDao(shared),
    seats: createInMemorySeatAssignmentDao(shared.seats),
    stats: createInMemoryPlayerStatsDao(shared.stats),
  };
}

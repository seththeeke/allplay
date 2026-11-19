import { GameSessionSchema, type GameSession } from "../../models/gameSession";
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

/**
 * GameSessionDao over a map (game-engine.md section 11.1). Items go through
 * the same schema and state codec as DynamoDB, and reads return copies, so
 * callers cannot change stored sessions by mutating results.
 */
export function createInMemoryGameSessionDao(): GameSessionDao {
  const items = new Map<string, StoredSession>();
  return {
    create: (session) => {
      if (items.has(session.sessionId))
        return Promise.reject(new SessionExistsError(session.sessionId));
      items.set(session.sessionId, store(session));
      return Promise.resolve();
    },
    get: (sessionId) => {
      const item = items.get(sessionId);
      return Promise.resolve(item === undefined ? null : load(item));
    },
    update: (session, expectedVersion) => {
      const current = items.get(session.sessionId);
      if (current?.version !== expectedVersion) {
        return Promise.reject(new SessionVersionConflictError(session.sessionId));
      }
      items.set(session.sessionId, store(session));
      return Promise.resolve();
    },
  };
}

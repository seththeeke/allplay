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
  /* Each method runs inside a promise so a schema failure rejects like a DynamoDB error would. */
  const run = <T>(work: () => T): Promise<T> =>
    new Promise((resolve) => {
      resolve(work());
    });
  return {
    create: (session) =>
      run(() => {
        if (items.has(session.sessionId)) throw new SessionExistsError(session.sessionId);
        items.set(session.sessionId, store(session));
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
  };
}

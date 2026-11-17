import { toEnvelope, type StoredSession } from "../../../test-data/spider/envelope";
import {
  applyAction,
  createSpider,
  hint,
  isWon,
  parseOptions,
  undo,
} from "../../../test-data/spider/simulator";
import type { ApiErrorCode, SessionEnvelope } from "../../models/api";
import { ApiRequestError } from "../errors";
import type { SessionService } from "../types";
import type { MemoryStore } from "./memoryStore";

const KEY = "allplay.memory.session.spider-solitaire";
const SPIDER = "spider-solitaire";

function fail(
  status: number,
  code: ApiErrorCode,
  message: string,
  current?: SessionEnvelope,
): never {
  throw new ApiRequestError(status, {
    code,
    message,
    ...(current === undefined ? {} : { current }),
  });
}

/**
 * In-memory game session API backed by the prototype Spider simulator. It
 * enforces the same version checks and error codes as the real API.
 */
export function createMemorySessionService(store: MemoryStore, seed: () => number): SessionService {
  const load = (): StoredSession | null => store.read<StoredSession | null>(KEY, null);
  const save = (session: StoredSession): void => {
    store.write(KEY, session);
  };
  const call = <T>(work: () => T): Promise<T> => Promise.resolve().then(work);

  const active = (sessionId: string, expectedVersion?: number): StoredSession => {
    const session = load();
    if (session?.sessionId !== sessionId) return fail(404, "NOT_FOUND", "Session not found");
    if (session.status !== "IN_PROGRESS")
      return fail(422, "GAME_OVER", "This game is over", toEnvelope(session));
    if (expectedVersion !== undefined && expectedVersion !== session.version) {
      return fail(409, "VERSION_CONFLICT", "The game has changed", toEnvelope(session));
    }
    return session;
  };

  const ensureSpider = (gameId: string): void => {
    if (gameId !== SPIDER) fail(404, "NOT_FOUND", `Unknown game ${gameId}`);
  };

  return {
    current: (gameId) =>
      call(() => {
        ensureSpider(gameId);
        const session = load();
        return session?.status === "IN_PROGRESS" ? toEnvelope(session) : null;
      }),
    start: (gameId, options) =>
      call(() => {
        ensureSpider(gameId);
        const session: StoredSession = {
          sessionId: `session-${String(Date.now())}`,
          status: "IN_PROGRESS",
          version: 0,
          state: createSpider(parseOptions(options), seed()),
        };
        save(session);
        return toEnvelope(session);
      }),
    apply: (sessionId, request) =>
      call(() => {
        const session = active(sessionId, request.expectedVersion);
        const events = applyAction(session.state, request.actionId);
        if (events === null)
          return fail(422, "ILLEGAL_ACTION", "That move is not allowed", toEnvelope(session));
        const won = isWon(session.state);
        const next: StoredSession = {
          ...session,
          version: session.version + 1,
          status: won ? "WON" : "IN_PROGRESS",
        };
        save(next);
        return toEnvelope(
          next,
          won ? [...events, { type: "GAME_WON", data: {}, speech: "You won" }] : events,
        );
      }),
    undo: (sessionId, request) =>
      call(() => {
        const session = active(sessionId, request.expectedVersion);
        const state = undo(session.state);
        if (state === null)
          return fail(422, "ILLEGAL_ACTION", "There is nothing to undo", toEnvelope(session));
        const next: StoredSession = { ...session, state, version: session.version + 1 };
        save(next);
        return toEnvelope(next, [{ type: "UNDONE", data: {}, speech: "Undone" }]);
      }),
    hint: (sessionId) =>
      call(() => {
        const action = hint(active(sessionId).state);
        return { action, text: action?.text ?? "No moves left. Undo, or start a new game." };
      }),
    abandon: (sessionId, request) =>
      call(() => {
        const session = active(sessionId, request.expectedVersion);
        const next: StoredSession = {
          ...session,
          status: "ABANDONED",
          version: session.version + 1,
        };
        save(next);
        return toEnvelope(next);
      }),
  };
}

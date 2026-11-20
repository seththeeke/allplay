import { randomBytes } from "node:crypto";
import {
  SessionVersionConflictError,
  type GameSessionDao,
} from "../../dao/gameSession/gameSessionDao";
import type { SeatAssignmentDao } from "../../dao/seatAssignment/seatAssignmentDao";
import { UnknownGameError } from "../../game-catalog";
import {
  IllegalActionError,
  InvalidGameInputError,
  UndoUnavailableError,
  type ApplyResult,
  type CompiledGame,
  type GameEvent,
  type GameState,
} from "../../game-engine";
import type { HintResponse, SessionEnvelope } from "../../models/api";
import type { GameSession } from "../../models/gameSession";
import {
  gameOver,
  illegalAction,
  invalidRequest,
  notFound,
  notSeated,
  versionConflict,
} from "./errors";
import { newUlid } from "./ulid";

/** Spider and every schema version 1 game seat their one player here. */
const SEAT = "S1";

export interface GameSessionServiceDeps {
  dao: GameSessionDao;
  seats: SeatAssignmentDao;
  /** The compiled game for an id and optional pinned version; throws UnknownGameError. */
  games: (gameId: string, version?: number) => CompiledGame;
  now?: () => Date;
  newSessionId?: () => string;
  newSeed?: () => string;
}

export interface GameSessionService {
  start(
    playerId: string,
    input: { gameId: string; options?: Record<string, unknown> | undefined },
  ): Promise<SessionEnvelope>;
  get(playerId: string, sessionId: string): Promise<SessionEnvelope>;
  /** The player's in-progress session of a game, or null (`GET /v1/sessions/current`). */
  current(playerId: string, gameId: string): Promise<SessionEnvelope | null>;
  applyAction(
    playerId: string,
    sessionId: string,
    input: { actionId: string; expectedVersion: number },
  ): Promise<SessionEnvelope>;
  undo(
    playerId: string,
    sessionId: string,
    input: { expectedVersion: number },
  ): Promise<SessionEnvelope>;
  hint(playerId: string, sessionId: string): Promise<HintResponse>;
  abandon(
    playerId: string,
    sessionId: string,
    input: { expectedVersion: number },
  ): Promise<SessionEnvelope>;
}

/** Display fields stored with the session: the game's vars and derived vars (data-model.md section 6). */
function summaryOf(game: CompiledGame, state: GameState): Record<string, number> {
  return { ...game.getView(state, SEAT).vars };
}

/** `name=value;name=value` sorted by name (game-engine.md section 4.1). */
export function variantKeyOf(options: Readonly<Record<string, unknown>>): string {
  return Object.keys(options)
    .sort()
    .map((name) => `${name}=${String(options[name])}`)
    .join(";");
}

/**
 * The only caller of the engine for session play (game-engine.md section 11):
 * loads and saves sessions through the DAO, checks seats and versions, and
 * returns the session envelope the HTTP API sends.
 */
export function createGameSessionService(deps: GameSessionServiceDeps): GameSessionService {
  const now = deps.now ?? (() => new Date());
  const newSessionId = deps.newSessionId ?? (() => newUlid(now().getTime()));
  const newSeed = deps.newSeed ?? (() => randomBytes(16).toString("hex"));

  const gameFor = (session: GameSession): CompiledGame =>
    deps.games(session.gameId, session.rulesVersion);

  const envelope = (session: GameSession, events: GameEvent[] = []): SessionEnvelope => {
    const game = gameFor(session);
    const view = game.getView(session.state, SEAT);
    const legalActions = game.listLegalActions(session.state, SEAT);
    return {
      session: {
        sessionId: session.sessionId,
        gameId: session.gameId,
        status: session.status,
        version: session.version,
        options: session.options,
        summary: session.summary,
      },
      view,
      legalActions,
      metaActions: [
        { id: "UNDO", available: session.status === "IN_PROGRESS" && view.status.canUndo },
        { id: "HINT", available: session.status === "IN_PROGRESS" && legalActions.length > 0 },
      ],
      events,
    };
  };

  const writeSeat = (session: GameSession, playerId: string, at: string): Promise<void> =>
    deps.seats.put({
      playerId,
      sessionId: session.sessionId,
      gameId: session.gameId,
      seatId: SEAT,
      status: session.status,
      lastActionAt: at,
      playerGameKey: `${playerId}|${session.gameId}`,
      statusSortKey: `${session.status}#${at}`,
      entityVersion: 1,
      createdAt: session.createdAt,
      updatedAt: at,
    });

  const load = async (playerId: string, sessionId: string): Promise<GameSession> => {
    const session = await deps.dao.get(sessionId);
    if (session === null) throw notFound("Session");
    if (!session.seats.some((seat) => seat.playerId === playerId)) throw notSeated();
    return session;
  };

  const loadForWrite = async (
    playerId: string,
    sessionId: string,
    expectedVersion: number,
  ): Promise<GameSession> => {
    const session = await load(playerId, sessionId);
    if (session.version !== expectedVersion) throw versionConflict(envelope(session));
    if (session.status !== "IN_PROGRESS") throw gameOver();
    return session;
  };

  const save = async (
    playerId: string,
    session: GameSession,
    next: Partial<GameSession>,
    expectedVersion: number,
  ): Promise<GameSession> => {
    const at = now().toISOString();
    const updated: GameSession = { ...session, ...next, updatedAt: at, lastActionAt: at };
    if (updated.status !== "IN_PROGRESS" && updated.endedAt === undefined) updated.endedAt = at;
    try {
      await deps.dao.update(updated, expectedVersion);
    } catch (error) {
      if (error instanceof SessionVersionConflictError) {
        throw versionConflict(envelope(await load(playerId, session.sessionId)));
      }
      throw error;
    }
    /* The seat changes only with the session status (data-model.md section 7). */
    if (updated.status !== session.status) {
      await Promise.all(updated.seats.map((seat) => writeSeat(updated, seat.playerId, at)));
    }
    return updated;
  };

  const fromResult = (session: GameSession, result: ApplyResult): Partial<GameSession> => ({
    state: result.state,
    version: result.state.version,
    status:
      result.state.status === "WON"
        ? "WON"
        : result.state.status === "IN_PROGRESS"
          ? "IN_PROGRESS"
          : "ABANDONED",
    summary: summaryOf(gameFor(session), result.state),
  });

  const engineCall = (call: () => ApplyResult): ApplyResult => {
    try {
      return call();
    } catch (error) {
      if (error instanceof IllegalActionError || error instanceof UndoUnavailableError)
        throw illegalAction(error.message);
      throw error;
    }
  };

  return {
    start: async (playerId, input) => {
      let game: CompiledGame;
      let state: GameState;
      try {
        game = deps.games(input.gameId);
        state = game.createGame({ options: input.options ?? {}, seed: newSeed(), seats: [SEAT] });
      } catch (error) {
        if (error instanceof UnknownGameError) throw notFound("Game");
        if (error instanceof InvalidGameInputError) throw invalidRequest(error.message);
        throw error;
      }
      /* Starting a game abandons the player's game of the same kind still in progress (game-engine.md section 11). */
      const previous = await deps.seats.currentFor(playerId, game.gameId);
      if (previous !== null) {
        const old = await deps.dao.get(previous.sessionId);
        if (old?.status === "IN_PROGRESS") {
          const version = old.version + 1;
          await save(
            playerId,
            old,
            { status: "ABANDONED", version, state: { ...old.state, version } },
            old.version,
          );
        }
      }
      const at = now().toISOString();
      const session: GameSession = {
        sessionId: newSessionId(),
        gameId: game.gameId,
        rulesSource: "CORE",
        rulesVersion: game.rulesVersion,
        engineSchemaVersion: state.engineSchemaVersion,
        options: state.options,
        variantKey: variantKeyOf(state.options),
        seats: [{ seatId: SEAT, playerId }],
        status: "IN_PROGRESS",
        version: state.version,
        state,
        summary: summaryOf(game, state),
        startedAt: at,
        entityVersion: 1,
        createdAt: at,
        updatedAt: at,
      };
      await deps.dao.create(session);
      await writeSeat(session, playerId, at);
      return envelope(session);
    },
    get: async (playerId, sessionId) => envelope(await load(playerId, sessionId)),
    current: async (playerId, gameId) => {
      const seat = await deps.seats.currentFor(playerId, gameId);
      return seat === null ? null : envelope(await load(playerId, seat.sessionId));
    },
    applyAction: async (playerId, sessionId, input) => {
      const session = await loadForWrite(playerId, sessionId, input.expectedVersion);
      const result = engineCall(() =>
        gameFor(session).applyAction(session.state, SEAT, input.actionId),
      );
      return envelope(
        await save(playerId, session, fromResult(session, result), input.expectedVersion),
        result.events,
      );
    },
    undo: async (playerId, sessionId, input) => {
      const session = await loadForWrite(playerId, sessionId, input.expectedVersion);
      const result = engineCall(() => gameFor(session).undo(session.state, SEAT));
      return envelope(
        await save(playerId, session, fromResult(session, result), input.expectedVersion),
        result.events,
      );
    },
    hint: async (playerId, sessionId) => {
      const session = await load(playerId, sessionId);
      const action =
        session.status === "IN_PROGRESS" ? gameFor(session).getHint(session.state, SEAT) : null;
      return { action, text: action?.text ?? "There are no moves left. Try undo or a new game." };
    },
    abandon: async (playerId, sessionId, input) => {
      const session = await loadForWrite(playerId, sessionId, input.expectedVersion);
      const version = session.version + 1;
      const state: GameState = { ...session.state, version };
      return envelope(
        await save(
          playerId,
          session,
          { status: "ABANDONED", version, state },
          input.expectedVersion,
        ),
        [{ type: "GAME_ABANDONED", data: {}, speech: null }],
      );
    },
  };
}

import { randomBytes } from "node:crypto";
import {
  SessionVersionConflictError,
  type GameSessionDao,
} from "../../dao/gameSession/gameSessionDao";
import type { PlayerStatsDao, StatsWrite } from "../../dao/playerStats/playerStatsDao";
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
import { statsKeyOf } from "../../models/playerStats";
import { logger } from "../../logger";
import {
  gameOver,
  illegalAction,
  invalidRequest,
  notFound,
  notSeated,
  versionConflict,
} from "./errors";
import {
  createMetricRollupDaoFor,
  createMetricsRecorder,
  type MetricsRecorder,
} from "../metrics/metricsRecorder";
import { createDeployedGameTables, withStatsRetry } from "./playerGameData";
import { foldResult } from "./playerStats";
import { abandonedCopy, isGuest, seatsOf, withSessionTtl } from "./sessionRecords";
import { newUlid } from "./ulid";

/** Spider and every schema version 1 game seat their one player here. */
const SEAT = "S1";

export interface GameSessionServiceDeps {
  dao: GameSessionDao;
  seats: SeatAssignmentDao;
  stats: PlayerStatsDao;
  /** Game starts, wins and abandons on the day's rollup (data-model.md section 11); absent locally. */
  metrics?: Pick<MetricsRecorder, "gameStarted" | "gameEnded">;
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

  /** The stats writes for an ended session: one per seat holder, when the result counts (data-model.md section 8). */
  const statsWrites = async (session: GameSession): Promise<StatsWrite[]> => {
    const moves = session.summary["moveCount"] ?? 0;
    if (session.status !== "WON" && moves < 1) return [];
    const statsKey = statsKeyOf(session.gameId, session.variantKey);
    return Promise.all(
      session.seats.map(async ({ playerId }) => {
        const current = await deps.stats.get(playerId, statsKey);
        const item = foldResult(current, {
          playerId,
          gameId: session.gameId,
          variantKey: session.variantKey,
          won: session.status === "WON",
          score: session.summary["score"] ?? 0,
          moves,
          at: session.endedAt ?? session.updatedAt,
          ttl: isGuest(playerId) ? withSessionTtl(session, now()).ttl : undefined,
        });
        return { item, expectedVersion: current?.version ?? null };
      }),
    );
  };

  /**
   * Writes the next state of a session the caller read at `expectedVersion`.
   * A move is one write; a status change ends the session together with its
   * seats and the seat holders' stats (data-model.md section 6).
   */
  const save = async (
    playerId: string,
    session: GameSession,
    next: Partial<GameSession>,
    expectedVersion: number,
  ): Promise<GameSession> => {
    const at = now();
    const stamp = at.toISOString();
    const updated = withSessionTtl(
      { ...session, ...next, updatedAt: stamp, lastActionAt: stamp },
      at,
    );
    try {
      if (updated.status === session.status) {
        await deps.dao.update(updated, expectedVersion);
        return updated;
      }
      if (updated.endedAt === undefined) updated.endedAt = stamp;
      await withStatsRetry(async () => {
        await deps.dao.end({
          session: updated,
          expectedVersion,
          seats: seatsOf(updated, at),
          stats: await statsWrites(updated),
        });
      });
      if (updated.status !== "IN_PROGRESS")
        await deps.metrics?.gameEnded(updated.gameId, updated.status);
      return updated;
    } catch (error) {
      if (error instanceof SessionVersionConflictError) {
        throw versionConflict(envelope(await load(playerId, session.sessionId)));
      }
      throw error;
    }
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
        if (old?.status === "IN_PROGRESS")
          await save(playerId, old, abandonedCopy(old, now()), old.version);
      }
      const started = now();
      const at = started.toISOString();
      const session: GameSession = withSessionTtl(
        {
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
        },
        started,
      );
      await deps.dao.create(session, seatsOf(session, started));
      await deps.metrics?.gameStarted(session.gameId);
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
      return envelope(
        await save(playerId, session, abandonedCopy(session, now()), input.expectedVersion),
        [{ type: "GAME_ABANDONED", data: {}, speech: null }],
      );
    },
  };
}

/** The session service over the deployed game tables and the bundled rules documents. */
export function createDeployedGameSessionService(
  repository: { compiled(gameId: string, version?: number): CompiledGame },
  env: Readonly<Record<string, string | undefined>> = process.env,
): GameSessionService {
  const rollups = createMetricRollupDaoFor(env);
  return createGameSessionService({
    ...createDeployedGameTables(env),
    ...(rollups === null ? {} : { metrics: createMetricsRecorder(rollups, logger) }),
    games: (gameId, version) => repository.compiled(gameId, version),
  });
}

import type {
  AbandonRequest,
  ApplyActionRequest,
  GameOptions,
  GamesResponse,
  HintResponse,
  SessionEnvelope,
  UndoRequest,
  PatchAppPreferences,
  PatchGamePreferences,
  PlayerMe,
  PreferencesResponse,
} from "../models/api";

/** Preferences API (authn-authz.md section 5): every change is saved as it happens. */
export interface PreferencesService {
  get(): Promise<PreferencesResponse>;
  patchApp(patch: PatchAppPreferences): Promise<PreferencesResponse>;
  patchGame(gameId: string, patch: PatchGamePreferences): Promise<PreferencesResponse>;
}

/** Current player. Sign-in here is a prototype stand-in until phase 4 wires Cognito. */
export interface PlayerService {
  me(): Promise<PlayerMe>;
  signIn(email: string): Promise<PlayerMe>;
  signOut(): Promise<PlayerMe>;
}

/** Game catalog (game-engine.md section 11). */
export interface GameService {
  list(): Promise<GamesResponse>;
}

/** Game session API (game-engine.md section 11). Failures reject with ApiRequestError. */
export interface SessionService {
  current(gameId: string): Promise<SessionEnvelope | null>;
  start(gameId: string, options?: GameOptions): Promise<SessionEnvelope>;
  apply(sessionId: string, request: ApplyActionRequest): Promise<SessionEnvelope>;
  undo(sessionId: string, request: UndoRequest): Promise<SessionEnvelope>;
  hint(sessionId: string): Promise<HintResponse>;
  abandon(sessionId: string, request: AbandonRequest): Promise<SessionEnvelope>;
}

export interface Services {
  games: GameService;
  sessions: SessionService;
  preferences: PreferencesService;
  player: PlayerService;
}

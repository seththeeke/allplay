import type {
  AbandonRequest,
  AdminDecisionsResponse,
  DeploymentsResponse,
  MetricsResponse,
  StartDeploymentResponse,
  DecisionRequest,
  DecisionResponse,
  ResolutionRequest,
  ResolutionResponse,
  ApplyActionRequest,
  GameOptions,
  GamesResponse,
  HealthResponse,
  HintResponse,
  SessionEnvelope,
  StatsResponse,
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

export type SignInProvider = "GOOGLE" | "APPLE";

/**
 * Current player and account flows (authn-authz.md sections 3 and 7). The
 * memory implementation is a prototype stand-in until AA-9 wires Cognito.
 */
export interface PlayerService {
  me(): Promise<PlayerMe>;
  signIn(email: string, password?: string): Promise<PlayerMe>;
  signInWithProvider(provider: SignInProvider): Promise<PlayerMe>;
  signUp(email: string, password: string): Promise<void>;
  confirmSignUp(email: string, code: string): Promise<PlayerMe>;
  requestPasswordReset(email: string): Promise<void>;
  confirmPasswordReset(email: string, code: string, newPassword: string): Promise<void>;
  signOut(): Promise<PlayerMe>;
  deleteAccount(): Promise<PlayerMe>;
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

/** Action decider API (action-decision.md section 4). */
export interface DecisionService {
  decide(request: DecisionRequest): Promise<DecisionResponse>;
  resolve(decisionId: string, request: ResolutionRequest): Promise<ResolutionResponse>;
}

/** Player statistics (data-model.md section 8). */
export interface StatsService {
  list(): Promise<StatsResponse>;
}

/** Admin API (authn-authz.md section 5). */
export interface AdminService {
  metrics(from: string, to: string): Promise<MetricsResponse>;
  failures(day: string): Promise<AdminDecisionsResponse>;
  deployments(): Promise<DeploymentsResponse>;
  startDeployment(): Promise<StartDeploymentResponse>;
}

/** Result of one call to `GET /v1/health`: the HTTP status, the parsed body when it matched the contract, and the round trip time. */
export interface HealthCheck {
  httpStatus: number;
  body: HealthResponse | null;
  latencyMs: number;
}

/** Stage health check (cdk-stacks.md section 5); live whenever the stage config carries an API URL. */
export interface HealthService {
  check(): Promise<HealthCheck>;
}

export interface Services {
  health: HealthService;
  admin: AdminService;
  stats: StatsService;
  decisions: DecisionService;
  games: GameService;
  sessions: SessionService;
  preferences: PreferencesService;
  player: PlayerService;
}

import type {
  GamesResponse,
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

export interface Services {
  games: GameService;
  preferences: PreferencesService;
  player: PlayerService;
}

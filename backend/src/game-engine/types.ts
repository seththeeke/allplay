/**
 * Public engine types (game-engine.md sections 6 to 10). They mirror the API
 * contracts in models/api structurally; the engine cannot import them because
 * it is isolated.
 */

export type SeatId = string;
export type Suit = "SPADES" | "HEARTS" | "DIAMONDS" | "CLUBS";
export type OptionValue = string | number | boolean;
export type GameStatus = "IN_PROGRESS" | "WON" | "LOST";

export interface CardState {
  suit: Suit;
  rank: number;
  faceUp: boolean;
}

export interface GameState {
  engineSchemaVersion: 1;
  gameId: string;
  rulesVersion: number;
  options: Record<string, OptionValue>;
  seed: string;
  seats: { seatId: SeatId }[];
  cards: Record<string, CardState>;
  zones: Record<string, string[]>;
  vars: Record<string, number>;
  history: string[];
  scoreCarry: number;
  status: GameStatus;
  version: number;
}

export interface CardFace {
  cardId: string;
  suit: Suit;
  rank: number;
  name: string;
}

export interface ZoneRef {
  zoneId: string;
  type: string;
  index: number;
  label: string;
}

export type ActionDescriptor =
  | {
      kind: "MOVE_CARDS";
      cards: CardFace[];
      from: ZoneRef;
      to: ZoneRef & { topCard: CardFace | null };
    }
  | { kind: "DEAL"; from: ZoneRef; cardCount: number }
  | { kind: "OTHER" };

export interface LegalAction {
  actionId: string;
  templateId: string;
  params: Record<string, string | number>;
  descriptor: ActionDescriptor;
  text: string;
  shortText: string;
  equivalenceKey?: string;
}

export interface GameEvent {
  type: string;
  data: Record<string, unknown>;
  speech: string | null;
}

export interface GameStatusInfo {
  status: GameStatus;
  blocked: boolean;
  canUndo: boolean;
}

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
  status: GameStatusInfo;
}

export type ActionValidation =
  | { valid: true; action: LegalAction }
  | { valid: false; reason: "UNKNOWN_ACTION" | "NOT_LEGAL" | "GAME_OVER" | "NOT_SEATED" };

export type CardView = (CardFace & { faceUp: true }) | { faceUp: false };

export interface ZoneView extends ZoneRef {
  layout: "FAN_DOWN" | "STACK" | "ROW";
  region: "TOP" | "MAIN" | "BOTTOM";
  count: number;
  cards: CardView[] | null;
}

export interface GameView {
  gameId: string;
  rulesVersion: number;
  options: Record<string, OptionValue>;
  status: GameStatusInfo;
  vars: Record<string, number>;
  zones: ZoneView[];
}

export interface GameOptionDefinition {
  name: string;
  type: "ENUM";
  values: OptionValue[];
  default: OptionValue;
  labels: Record<string, string>;
}

export interface GameCatalogEntry {
  gameId: string;
  name: string;
  description: string;
  path: string;
  latestVersion: number;
  players: { min: number; max: number };
  options: GameOptionDefinition[];
  source: "CORE" | "COMMUNITY";
}

export interface CreateGameInput {
  options: Record<string, unknown>;
  seed: string;
  seats: SeatId[];
}

export interface CompiledGame {
  readonly gameId: string;
  readonly rulesVersion: number;
  readonly catalogEntry: GameCatalogEntry;
  createGame(input: CreateGameInput): GameState;
  getView(state: GameState, seatId: SeatId): GameView;
  listLegalActions(state: GameState, seatId: SeatId): LegalAction[];
  validateAction(state: GameState, seatId: SeatId, actionId: string): ActionValidation;
  applyAction(state: GameState, seatId: SeatId, actionId: string): ApplyResult;
  undo(state: GameState, seatId: SeatId): ApplyResult;
  getHint(state: GameState, seatId: SeatId): LegalAction | null;
  getStatus(state: GameState): GameStatusInfo;
}

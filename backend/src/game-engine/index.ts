/** The game engine's public surface (game-engine.md section 8); nothing else is importable from outside. */
export {
  compileRules,
  validateRules,
  type RulesValidationResult,
  type ValidateOptions,
} from "./rules/compile";
export type { SimulationOptions } from "./rules/simulate";
export type { RulesDocument } from "./rules/schema";
export {
  EngineInvariantError,
  IllegalActionError,
  InvalidGameInputError,
  RulesValidationError,
  UndoUnavailableError,
  type IllegalActionReason,
} from "./errors";
export { SEED_PATTERN } from "./random/xoshiro";
export type {
  ActionDescriptor,
  ActionValidation,
  ApplyResult,
  CardFace,
  CardState,
  CardView,
  CompiledGame,
  CreateGameInput,
  GameCatalogEntry,
  GameEvent,
  GameOptionDefinition,
  GameState,
  GameStatus,
  GameStatusInfo,
  GameView,
  LegalAction,
  OptionValue,
  SeatId,
  Suit,
  ZoneRef,
  ZoneView,
} from "./types";

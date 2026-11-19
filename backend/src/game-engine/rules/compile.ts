import { RulesValidationError } from "../errors";
import { applyAction, statusOf, undo, validateAction } from "../interpreter/apply";
import { createGame } from "../interpreter/create";
import type { Engine } from "../interpreter/engine";
import { listLegalActions } from "../interpreter/enumerate";
import { getHint } from "../interpreter/hints";
import { buildLayout } from "../primitives/layout";
import type { CompiledGame, GameCatalogEntry, OptionValue } from "../types";
import { buildView } from "../view/view";
import { RulesDocumentSchema, type RulesDocument } from "./schema";
import { staticChecks } from "./staticChecks";

export type RulesValidationResult =
  { valid: true; rules: RulesDocument } | { valid: false; issues: string[] };

/** validateRules (game-engine.md section 13): the schema, then the static checks. */
export function validateRules(doc: unknown): RulesValidationResult {
  const parsed = RulesDocumentSchema.safeParse(doc);
  if (!parsed.success) {
    return {
      valid: false,
      issues: parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "document"}: ${issue.message}`,
      ),
    };
  }
  const issues = staticChecks(parsed.data);
  return issues.length === 0 ? { valid: true, rules: parsed.data } : { valid: false, issues };
}

function catalogEntry(rules: RulesDocument): GameCatalogEntry {
  return {
    gameId: rules.gameId,
    name: rules.name,
    description: rules.description,
    path: rules.path,
    latestVersion: rules.version,
    players: { ...rules.players },
    options: Object.entries(rules.options).map(([name, option]) => ({
      name,
      type: option.type,
      values: [...option.values] as OptionValue[],
      default: option.default,
      labels: { ...option.labels },
    })),
    source: "CORE",
  };
}

/** compileRules (section 8): validates, derives the layout and returns the game's interface. */
export function compileRules(doc: unknown): CompiledGame {
  const result = validateRules(doc);
  if (!result.valid) throw new RulesValidationError(result.issues);
  const { rules } = result;
  const engine: Engine = {
    rules,
    layout: buildLayout(rules.zones),
    templates: new Map(rules.actions.map((action) => [action.id, action])),
  };
  const seated = (state: { seats: { seatId: string }[] }, seatId: string): boolean =>
    state.seats.some((seat) => seat.seatId === seatId);
  return {
    gameId: rules.gameId,
    rulesVersion: rules.version,
    catalogEntry: catalogEntry(rules),
    createGame: (input) => createGame(engine, input),
    getView: (state) => buildView(state, engine.layout, statusOf(engine, state)),
    listLegalActions: (state, seatId) =>
      seated(state, seatId) ? listLegalActions(engine, state) : [],
    validateAction: (state, seatId, actionId) => validateAction(engine, state, seatId, actionId),
    applyAction: (state, seatId, actionId) => applyAction(engine, state, seatId, actionId),
    undo: (state, seatId) => undo(engine, state, seatId),
    getHint: (state, seatId) => (seated(state, seatId) ? getHint(engine, state) : null),
    getStatus: (state) => statusOf(engine, state),
  };
}

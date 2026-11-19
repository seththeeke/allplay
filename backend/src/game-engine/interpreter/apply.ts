import { IllegalActionError, UndoUnavailableError } from "../errors";
import { changeVar, runEffect } from "../primitives/effects";
import { eventText } from "../speech/templates";
import type { ApplyResult, GameEvent, GameState, GameStatusInfo, SeatId } from "../types";
import { createGame } from "./create";
import { checkInvariants, cloneState, mutationContext, type Engine } from "./engine";
import {
  actionIdOf,
  hasLegalAction,
  isLegalBinding,
  parseActionId,
  toLegalAction,
  type Binding,
} from "./enumerate";
import { evaluateEndConditions, settleTriggers } from "./triggers";
import type { ActionTemplate } from "../rules/schema";
import type { ActionValidation } from "../types";

export function statusOf(engine: Engine, state: GameState): GameStatusInfo {
  const inProgress = state.status === "IN_PROGRESS";
  return {
    status: state.status,
    blocked: inProgress && !hasLegalAction(engine, state),
    canUndo: inProgress && engine.rules.undo.allowed && state.history.length > 0,
  };
}

/** validateAction (game-engine.md section 8): checks the seat, the status, then the one binding. */
export function validateAction(
  engine: Engine,
  state: GameState,
  seatId: SeatId,
  actionId: string,
): ActionValidation {
  if (!state.seats.some((seat) => seat.seatId === seatId))
    return { valid: false, reason: "NOT_SEATED" };
  if (state.status !== "IN_PROGRESS") return { valid: false, reason: "GAME_OVER" };
  const parsed = parseActionId(engine, actionId);
  if (parsed === null) return { valid: false, reason: "UNKNOWN_ACTION" };
  if (!isLegalBinding(engine, parsed.template, parsed.binding, state))
    return { valid: false, reason: "NOT_LEGAL" };
  return { valid: true, action: toLegalAction(engine, parsed.template, parsed.binding, state) };
}

/** Steps 3 to 7 of section 7.3 on a private copy; the caller has already checked legality. */
function perform(
  engine: Engine,
  state: GameState,
  template: ActionTemplate,
  binding: Binding,
): { state: GameState; events: GameEvent[] } {
  const next = cloneState(state);
  const events: GameEvent[] = [];
  const ctx = { ...mutationContext(engine, next, events), params: binding };
  for (const effect of template.effects) runEffect(effect, ctx);
  changeVar(ctx, "score", template.score);
  if (template.countsAsMove) changeVar(ctx, "moveCount", 1);
  settleTriggers(engine, ctx);
  evaluateEndConditions(engine, ctx);
  next.history.push(actionIdOf(template, binding));
  next.version += 1;
  checkInvariants(next);
  return { state: next, events };
}

/** The state after a legal action, for callers that only look (hints); no events or status. */
export function simulate(
  engine: Engine,
  state: GameState,
  template: ActionTemplate,
  binding: Binding,
): GameState {
  return perform(engine, state, template, binding).state;
}

function withSpeech(engine: Engine, state: GameState, events: GameEvent[]): GameEvent[] {
  return events.map((event) => ({
    ...event,
    speech: eventText(event, engine.rules.speech.events, state, engine.layout),
  }));
}

/** applyAction (section 7.3). Throws IllegalActionError with the validation reason. */
export function applyAction(
  engine: Engine,
  state: GameState,
  seatId: SeatId,
  actionId: string,
): ApplyResult {
  const validation = validateAction(engine, state, seatId, actionId);
  if (!validation.valid) throw new IllegalActionError(validation.reason, actionId);
  const parsed = parseActionId(engine, actionId) as { template: ActionTemplate; binding: Binding };
  const result = perform(engine, state, parsed.template, parsed.binding);
  return {
    state: result.state,
    events: withSpeech(engine, result.state, result.events),
    status: statusOf(engine, result.state),
  };
}

/** Rebuilds a state from its seed and an action history, without checking seats (section 7.4). */
export function replay(engine: Engine, base: GameState, history: readonly string[]): GameState {
  let state = createGame(engine, {
    options: base.options,
    seed: base.seed,
    seats: base.seats.map((seat) => seat.seatId),
  });
  for (const actionId of history) {
    const parsed = parseActionId(engine, actionId);
    if (parsed === null || !isLegalBinding(engine, parsed.template, parsed.binding, state)) {
      throw new IllegalActionError("NOT_LEGAL", actionId);
    }
    state = perform(engine, state, parsed.template, parsed.binding).state;
  }
  return state;
}

/**
 * undo (section 7.4): replays the history without its last action, then
 * applies the undo penalty and, unless refunded, keeps the undone action's own
 * score delta in `scoreCarry`.
 */
export function undo(engine: Engine, state: GameState, seatId: SeatId): ApplyResult {
  if (!state.seats.some((seat) => seat.seatId === seatId))
    throw new IllegalActionError("NOT_SEATED", "UNDO");
  if (!statusOf(engine, state).canUndo) throw new UndoUnavailableError("Nothing to undo");
  const undone = state.history.at(-1) as string;
  const template = parseActionId(engine, undone)?.template;
  const { undo: rule } = engine.rules;
  const kept = rule.refundUndoneAction ? 0 : (template?.score ?? 0);
  const next = replay(engine, state, state.history.slice(0, -1));
  next.scoreCarry = state.scoreCarry + rule.score + kept;
  next.vars["score"] = (next.vars["score"] ?? 0) + next.scoreCarry;
  next.vars["undoCount"] = (state.vars["undoCount"] ?? 0) + 1;
  next.version = state.version + 1;
  const events: GameEvent[] = [{ type: "ACTION_UNDONE", data: { actionId: undone }, speech: null }];
  return { state: next, events: withSpeech(engine, next, events), status: statusOf(engine, next) };
}

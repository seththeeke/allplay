import type { CompiledGame, GameState } from "../../src/game-engine";

const SEAT = "S1";

export interface SolverResult {
  actions: string[];
  state: GameState;
}

/**
 * Test-only solver (game-engine.md section 11.2): follows the engine's own
 * hints from a seed until the game ends, blocks, or `limit` actions pass.
 * It finds the winning lines the functional scenarios record; scenarios then
 * replay those lines rather than searching.
 */
export function followHints(game: CompiledGame, state: GameState, limit = 400): SolverResult {
  const actions: string[] = [];
  let current = state;
  while (actions.length < limit && current.status === "IN_PROGRESS") {
    const hint = game.getHint(current, SEAT);
    if (hint === null) break;
    current = game.applyAction(current, SEAT, hint.actionId).state;
    actions.push(hint.actionId);
  }
  return { actions, state: current };
}

/** Plays a fixed line; every action must be legal where it is played. */
export function playLine(game: CompiledGame, state: GameState, line: readonly string[]): GameState {
  return line.reduce((current, actionId) => game.applyAction(current, SEAT, actionId).state, state);
}
